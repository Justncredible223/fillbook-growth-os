import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_VIDEO_RENDERS_PER_MONTH, MAX_VIDEO_RENDERS_PER_DAY } from "./videoRenderEligibility.js";

interface EnqueueResultRow {
  video_render_id: string | null;
  job_id: string | null;
  already_existed: boolean;
  eligible: boolean;
  reason: string | null;
}

/**
 * Belt-and-suspenders sweep for the residual crash window between
 * `campaigns.status='approved'` and the `enqueue_video_render` RPC call
 * in approvals.ts's approve branch -- see the implementation plan's
 * "Approval/enqueue reliability" section. Finds every approved
 * video_script asset with no video_renders row at all and calls the same
 * idempotent RPC used by the live approval path, so there is exactly one
 * "is this a duplicate" implementation, not two to keep in sync.
 */
export async function reconcileVideoRenders(
  client: SupabaseClient,
  monthlyCap: number = MAX_VIDEO_RENDERS_PER_MONTH,
  dailyCap: number = MAX_VIDEO_RENDERS_PER_DAY,
): Promise<string> {
  const { data: assets, error: assetsError } = await client
    .from("campaign_assets")
    .select("id, asset_type, campaigns(status)")
    .eq("asset_type", "video_script");
  if (assetsError) throw new Error(`reconcileVideoRenders failed to load campaign_assets: ${assetsError.message}`);

  const approvedAssetIds = ((assets ?? []) as unknown as Array<{ id: string; campaigns: { status: string } | null }>)
    .filter((a) => a.campaigns?.status === "approved")
    .map((a) => a.id);
  if (approvedAssetIds.length === 0) return "0 approved video_script assets found";

  const { data: existingRenders, error: rendersError } = await client
    .from("video_renders")
    .select("campaign_asset_id")
    .in("campaign_asset_id", approvedAssetIds);
  if (rendersError) throw new Error(`reconcileVideoRenders failed to load video_renders: ${rendersError.message}`);

  const alreadyQueued = new Set((existingRenders ?? []).map((r: { campaign_asset_id: string }) => r.campaign_asset_id));
  const missing = approvedAssetIds.filter((id) => !alreadyQueued.has(id));
  if (missing.length === 0) return `0 missing renders (${approvedAssetIds.length} approved assets already have a row)`;

  let enqueued = 0;
  let capBlocked = 0;
  for (const campaignAssetId of missing) {
    const { data, error } = await client.rpc("enqueue_video_render", {
      p_campaign_asset_id: campaignAssetId,
      p_monthly_cap: monthlyCap,
      p_daily_cap: dailyCap,
    });
    if (error) throw new Error(`enqueue_video_render failed for ${campaignAssetId}: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as EnqueueResultRow | undefined;
    if (row?.eligible) enqueued++;
    else capBlocked++;
  }

  return `${enqueued} enqueued, ${capBlocked} blocked by the daily or monthly cap (${missing.length} were missing a render row)`;
}
