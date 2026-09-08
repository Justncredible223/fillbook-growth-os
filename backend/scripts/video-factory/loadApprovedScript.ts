import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { VideoFactoryError, type VideoScript, type VideoScriptPackage } from "./types.js";

/**
 * Same Supabase project URL the backend uses (backend/src/lib/
 * supabaseClient.ts) -- not a secret, imported rather than duplicated.
 * The service_role key still has to come from the environment; this CLI
 * is never given a hardcoded credential.
 */
export { SUPABASE_URL } from "../../src/lib/supabaseClient.js";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

/** Validates the nested production-package fields, used by both retrieval paths. */
export function validateVideoScript(raw: unknown): VideoScript {
  if (typeof raw !== "object" || raw === null) {
    throw new VideoFactoryError("videoScript is missing or not an object.");
  }
  const v = raw as Record<string, unknown>;
  const missing: string[] = [];
  if (!isNonEmptyString(v.hook)) missing.push("hook");
  if (!isNonEmptyString(v.script)) missing.push("script");
  if (!isStringArray(v.shotList) || v.shotList.length === 0) missing.push("shotList (non-empty string array)");
  if (!isNonEmptyString(v.youtubeTitle)) missing.push("youtubeTitle");
  if (!isNonEmptyString(v.youtubeDescription)) missing.push("youtubeDescription");
  if (!isNonEmptyString(v.tiktokCaption)) missing.push("tiktokCaption");
  if (!isStringArray(v.hashtags)) missing.push("hashtags (string array)");
  // disclosureCta is intentionally NOT required -- null is a valid, honest
  // answer (see videoScriptWriter.ts's own doc comment: never a fabricated
  // filler line when the video genuinely doesn't need one).
  if (v.disclosureCta !== null && !isNonEmptyString(v.disclosureCta)) missing.push("disclosureCta (string or null)");
  if (missing.length > 0) {
    throw new VideoFactoryError(`videoScript is missing required field(s): ${missing.join(", ")}`);
  }
  return {
    hook: v.hook as string,
    script: v.script as string,
    shotList: v.shotList as string[],
    youtubeTitle: v.youtubeTitle as string,
    youtubeDescription: v.youtubeDescription as string,
    tiktokCaption: v.tiktokCaption as string,
    hashtags: v.hashtags as string[],
    disclosureCta: (v.disclosureCta as string | null) ?? null,
  };
}

/**
 * Validates a full VideoScriptPackage shape. Does NOT check approval --
 * that's assertApproved's job, kept separate so callers can distinguish
 * "malformed input" from "not approved yet" failures.
 */
export function validateVideoScriptPackage(raw: unknown): VideoScriptPackage {
  if (typeof raw !== "object" || raw === null) {
    throw new VideoFactoryError("Production package is not a JSON object.");
  }
  const p = raw as Record<string, unknown>;
  const missing: string[] = [];
  if (!isNonEmptyString(p.draftId)) missing.push("draftId");
  if (!isNonEmptyString(p.campaignTitle)) missing.push("campaignTitle");
  if (!isNonEmptyString(p.platform)) missing.push("platform");
  if (!isNonEmptyString(p.assetType)) missing.push("assetType");
  if (missing.length > 0) {
    throw new VideoFactoryError(`Production package is missing required field(s): ${missing.join(", ")}`);
  }
  if (p.assetType !== "video_script") {
    throw new VideoFactoryError(`Asset type is "${String(p.assetType)}", not "video_script" -- this CLI only renders video scripts.`);
  }
  const videoScript = validateVideoScript(p.videoScript);

  return {
    draftId: p.draftId as string,
    campaignTitle: p.campaignTitle as string,
    platform: p.platform as string,
    assetType: p.assetType as string,
    videoScript,
    approvedBy: isNonEmptyString(p.approvedBy) ? p.approvedBy : null,
    approvedAt: isNonEmptyString(p.approvedAt) ? p.approvedAt : "",
  };
}

/**
 * The one gate that decides whether rendering may proceed. Deliberately
 * its own function, called exactly once from index.ts right after
 * loading -- never inlined into the loaders themselves -- so it's
 * impossible for a future change to a loader to accidentally skip it.
 * `approvedAt` empty/missing is the single source of truth: for the
 * Supabase path that's populated only when campaigns.status = 'approved'
 * (see POST /api/approvals, the only code path that ever sets that
 * status); for --input mode the JSON file must state it explicitly --
 * there is no way to render an offline package without asserting this.
 */
export function assertApproved(pkg: VideoScriptPackage): void {
  if (!pkg.approvedAt) {
    throw new VideoFactoryError(
      `Draft "${pkg.draftId}" has not been approved. Approve it in the Approvals screen first -- ` +
        `this tool refuses to render anything the human owner hasn't signed off on.`,
    );
  }
}

/**
 * Fetches an approved draft directly from Supabase by campaign_assets.id
 * (the same id the Approvals API calls `campaignAssetId`). Requires the
 * structured VideoScript to already exist in content_versions.metadata
 * (see backend/src/content/campaignPipeline.ts) -- drafts generated
 * before that existed don't have it, and re-parsing the flattened text
 * block would be strictly less reliable than the data already being
 * there, so this fails clearly instead of guessing.
 */
export async function loadFromSupabase(draftId: string, client: SupabaseClient): Promise<VideoScriptPackage> {
  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .select("id, platform, asset_type, campaign_id, campaigns(thesis, status, decided_by, decided_at)")
    .eq("id", draftId)
    .maybeSingle();
  if (assetError) throw new VideoFactoryError(`Failed to load campaign_assets row: ${assetError.message}`);
  if (!asset) throw new VideoFactoryError(`No campaign_assets row found with id "${draftId}".`);

  const campaign = (asset as unknown as { campaigns: { thesis: string; status: string; decided_by: string | null; decided_at: string | null } | null }).campaigns;
  if (!campaign) throw new VideoFactoryError(`Draft "${draftId}" has no associated campaign row -- data integrity issue.`);

  if (asset.asset_type !== "video_script") {
    throw new VideoFactoryError(
      `Draft "${draftId}" has asset_type "${asset.asset_type}", not "video_script" -- this CLI only renders video scripts.`,
    );
  }

  const { data: version, error: versionError } = await client
    .from("content_versions")
    .select("body, metadata")
    .eq("campaign_asset_id", draftId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) throw new VideoFactoryError(`Failed to load content_versions row: ${versionError.message}`);
  if (!version) throw new VideoFactoryError(`Draft "${draftId}" has no content_versions row.`);

  const metadata = (version.metadata ?? {}) as Record<string, unknown>;
  if (!metadata.videoScript) {
    throw new VideoFactoryError(
      `Draft "${draftId}" has no structured videoScript in content_versions.metadata -- it was likely generated ` +
        `before this field existed. Re-run the campaign for its opportunity to regenerate a structured package.`,
    );
  }
  const videoScript = validateVideoScript(metadata.videoScript);

  return {
    draftId,
    campaignTitle: campaign.thesis,
    platform: asset.platform,
    assetType: asset.asset_type,
    videoScript,
    approvedBy: campaign.decided_by,
    approvedAt: campaign.status === "approved" ? (campaign.decided_at ?? "") : "",
  };
}

/**
 * Loads and validates an offline production-package JSON file -- the
 * fallback path when direct Supabase retrieval isn't wanted. The file
 * must explicitly assert `approvedAt` itself; see assertApproved.
 */
export function loadFromFile(path: string): VideoScriptPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new VideoFactoryError(`Failed to read/parse "${path}": ${(err as Error).message}`);
  }
  return validateVideoScriptPackage(raw);
}

/**
 * Builds a Supabase client from the environment, same service_role-key
 * requirement as the backend's getServiceClient() but with an error
 * message that doesn't reference Vercel (this always runs locally).
 */
export function createLocalSupabaseClient(supabaseUrl: string, env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new VideoFactoryError(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to backend/.env.local (this CLI reads that file) -- " +
        "the same value already set in Vercel's project environment variables.",
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}
