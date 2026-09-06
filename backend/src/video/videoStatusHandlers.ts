import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface VideoRenderStatusJson {
  id: string;
  campaignAssetId: string;
  status: "queued" | "rendering" | "ready" | "failed" | "canceled";
  storagePath: string | null;
  durationSeconds: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
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

/** Polled by the Android Video Status screen -- the durable source of truth for render state, independent of whether any push notification was ever delivered (see the implementation plan's "Honest limit on exactly-once" note). */
export async function listVideoRenderStatuses(client: SupabaseClient, limit = 50): Promise<VideoRenderStatusJson[]> {
  const { data, error } = await client
    .from("video_renders")
    .select("id, campaign_asset_id, status, storage_path, duration_seconds, error, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listVideoRenderStatuses failed: ${error.message}`);
  return ((data ?? []) as VideoRenderRow[]).map((row) => ({
    id: row.id,
    campaignAssetId: row.campaign_asset_id,
    status: row.status,
    storagePath: row.storage_path,
    durationSeconds: row.duration_seconds,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
