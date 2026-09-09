import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The platform-specific publishing metadata generated alongside the video
 * script (see backend/src/content/videoScriptWriter.ts's VideoScript) --
 * surfaced here so Video Status can show copyable YouTube/TikTok sections
 * without a separate fetch. Null whenever the underlying content_versions
 * row has no structured videoScript metadata (e.g. a render created before
 * this field existed) -- never fabricated.
 */
export interface VideoRenderMetadataJson {
  youtubeTitle: string;
  youtubeDescription: string;
  tiktokCaption: string;
  hashtags: string[];
  disclosureCta: string | null;
  youtubeThumbnailConcept: string | null;
}

export interface VideoRenderStatusJson {
  id: string;
  campaignAssetId: string;
  status: "queued" | "rendering" | "ready" | "failed" | "canceled";
  storagePath: string | null;
  /** A short-lived signed URL into the private rendered-videos bucket -- never a public/permanent link. Present only when status='ready' and the signing call itself succeeds; null otherwise (including a transient signing failure, which never blocks the rest of the status list). The app must treat a stale one as expired and re-fetch this endpoint for a fresh URL rather than caching it. */
  downloadUrl: string | null;
  durationSeconds: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  videoMetadata: VideoRenderMetadataJson | null;
}

/**
 * Pure parsing, independent of Supabase -- given whatever raw JSON sits in
 * content_versions.metadata, returns the typed publishing metadata or null.
 * Deliberately tolerant of a partially-shaped object (returns null rather
 * than throwing) since a render's metadata is best-effort display, never
 * something that should break the whole status list.
 */
export function parseVideoRenderMetadata(rawMetadata: unknown): VideoRenderMetadataJson | null {
  if (typeof rawMetadata !== "object" || rawMetadata === null) return null;
  const videoScript = (rawMetadata as Record<string, unknown>).videoScript;
  if (typeof videoScript !== "object" || videoScript === null) return null;
  const v = videoScript as Record<string, unknown>;
  if (
    typeof v.youtubeTitle !== "string" ||
    typeof v.youtubeDescription !== "string" ||
    typeof v.tiktokCaption !== "string" ||
    !Array.isArray(v.hashtags) ||
    !v.hashtags.every((h) => typeof h === "string")
  ) {
    return null;
  }
  return {
    youtubeTitle: v.youtubeTitle,
    youtubeDescription: v.youtubeDescription,
    tiktokCaption: v.tiktokCaption,
    hashtags: v.hashtags as string[],
    disclosureCta: typeof v.disclosureCta === "string" ? v.disclosureCta : null,
    youtubeThumbnailConcept: typeof v.youtubeThumbnailConcept === "string" ? v.youtubeThumbnailConcept : null,
  };
}

interface VideoRenderRow {
  id: string;
  campaign_asset_id: string;
  status: VideoRenderStatusJson["status"];
  storage_path: string | null;
  duration_seconds: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STORAGE_BUCKET = "rendered-videos";
/** Generous for a phone-only flow (approve -> notification -> open app -> download, possibly minutes apart) while staying short-lived -- never a permanent/public link. */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Polled by the Android Video Status screen -- the durable source of truth for render state, independent of whether any push notification was ever delivered (see the implementation plan's "Honest limit on exactly-once" note). Every call mints a fresh signed URL for each 'ready' row, so the app never needs to cache one past its own screen session -- an expired link is simply fixed by pulling to refresh. */
export async function listVideoRenderStatuses(client: SupabaseClient, limit = 50): Promise<VideoRenderStatusJson[]> {
  const { data, error } = await client
    .from("video_renders")
    .select("id, campaign_asset_id, status, storage_path, duration_seconds, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listVideoRenderStatuses failed: ${error.message}`);

  const rows = (data ?? []) as VideoRenderRow[];

  // One batched query for every row's own latest content_versions.metadata,
  // instead of one query per row -- a render's own campaign_asset_id is the
  // join key. Best-effort: a failure here never fails the whole status
  // list (same tolerance already applied to signed-URL minting below), it
  // just leaves videoMetadata null for every row this call.
  const metadataByAssetId = new Map<string, VideoRenderMetadataJson | null>();
  const assetIds = [...new Set(rows.map((r) => r.campaign_asset_id))];
  if (assetIds.length > 0) {
    const { data: versions } = await client
      .from("content_versions")
      .select("campaign_asset_id, metadata, version")
      .in("campaign_asset_id", assetIds)
      .order("version", { ascending: false });
    for (const v of (versions ?? []) as Array<{ campaign_asset_id: string; metadata: unknown }>) {
      // Rows arrive ordered by version desc -- the first one seen per
      // asset id is its latest version, so a later (older) row for the
      // same asset is skipped rather than overwriting it.
      if (metadataByAssetId.has(v.campaign_asset_id)) continue;
      metadataByAssetId.set(v.campaign_asset_id, parseVideoRenderMetadata(v.metadata));
    }
  }

  return Promise.all(
    rows.map(async (row) => {
      let downloadUrl: string | null = null;
      if (row.status === "ready" && row.storage_path) {
        // A signing failure (bucket hiccup, transient error) never fails the
        // whole status list -- this row just surfaces with no download link,
        // and the next refresh tries again, same "never block on a
        // best-effort extra" pattern used throughout this feature.
        const { data: signed } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
        downloadUrl = signed?.signedUrl ?? null;
      }
      return {
        id: row.id,
        campaignAssetId: row.campaign_asset_id,
        status: row.status,
        storagePath: row.storage_path,
        downloadUrl,
        durationSeconds: row.duration_seconds,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        videoMetadata: metadataByAssetId.get(row.campaign_asset_id) ?? null,
      };
    }),
  );
}

/**
 * Deletes a failed or canceled render row so the owner can clear stuck
 * items from the Video Status screen. Only allows dismissing terminal
 * states (failed/canceled) -- a ready render is a deliverable and must not
 * be deleted; a queued/rendering one is active and should not be silently
 * dropped (cancel that via the GitHub Actions UI instead).
 */
export async function dismissVideoRender(client: SupabaseClient, videoRenderId: string): Promise<void> {
  const { data, error: fetchError } = await client
    .from("video_renders")
    .select("status")
    .eq("id", videoRenderId)
    .maybeSingle();
  if (fetchError) throw new Error(`dismissVideoRender fetch failed: ${fetchError.message}`);
  if (!data) throw new Error(`video render not found: ${videoRenderId}`);
  const status = (data as { status: string }).status;
  if (status !== "failed" && status !== "canceled") {
    throw new Error(`can only dismiss failed or canceled renders (got: ${status})`);
  }
  const { error: deleteError } = await client.from("video_renders").delete().eq("id", videoRenderId);
  if (deleteError) throw new Error(`dismissVideoRender delete failed: ${deleteError.message}`);
}

/** One-way fingerprint of the app's own bearer credential -- never the credential itself -- stored alongside each device token purely for future credential-rotation cleanup (see migration 0027's doc comment on device_push_tokens). */
export function fingerprintAppToken(appApiToken: string): string {
  return createHash("sha256").update(appApiToken).digest("hex");
}

/**
 * Registers (or re-activates) an FCM device token for push delivery.
 * Upserts on the token's own uniqueness (a fresh install or token refresh
 * naturally produces a new value; the same physical token reappearing
 * just refreshes last_seen_at and clears any prior revocation).
 */
export async function registerDevicePushToken(client: SupabaseClient, fcmToken: string, appApiToken: string): Promise<void> {
  const { error } = await client.from("device_push_tokens").upsert(
    {
      fcm_token: fcmToken,
      app_token_fingerprint: fingerprintAppToken(appApiToken),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "fcm_token" },
  );
  if (error) throw new Error(`registerDevicePushToken failed: ${error.message}`);
}
