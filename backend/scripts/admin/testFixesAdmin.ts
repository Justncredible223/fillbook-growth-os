/**
 * Temporary, one-off admin script -- NOT part of the regular pipeline.
 * Run once via a manual GitHub Actions dispatch (has SUPABASE_SERVICE_ROLE_KEY
 * already as a repo secret) to:
 *   1. Clear the current Prospecting queue (mark all non-terminal candidates
 *      "not_relevant") so the next fresh search is easy to inspect on its own.
 *   2. Look for any video_script campaign already sitting at ready_for_owner
 *      with an in_review campaign (i.e. already AI-reviewed, just waiting on
 *      a human tap) and, if one exists, approve it and enqueue its render --
 *      this exercises the real approve -> enqueue_video_render -> dispatch
 *      path with zero new LLM spend, reusing work already done.
 * Never touches asset content generation (no LLM calls) -- only flips
 * existing rows the same way the app's own UI actions would.
 * Delete this file after use; it is not meant to be a permanent script.
 */
import { getServiceClient } from "../../src/lib/supabaseClient.js";
import { MAX_VIDEO_RENDERS_PER_MONTH, MAX_VIDEO_RENDERS_PER_DAY } from "../../src/video/videoRenderEligibility.js";

async function main() {
  const client = getServiceClient();

  // 1. Clear the current Prospecting queue.
  const { data: cleared, error: clearError } = await client
    .from("prospecting_candidates")
    .update({ status: "not_relevant" })
    .in("status", ["new", "shown", "drafting", "ready"])
    .select("id");
  if (clearError) throw new Error(`clear prospecting queue failed: ${clearError.message}`);
  console.log(`Cleared ${cleared?.length ?? 0} prospecting candidates (marked not_relevant).`);

  // 2. Find a video_script already reviewed and waiting on approval.
  const { data: waiting, error: waitingError } = await client
    .from("campaign_assets")
    .select("id, campaign_id, campaigns!inner(status)")
    .eq("asset_type", "video_script")
    .eq("stage", "ready_for_owner")
    .eq("campaigns.status", "in_review")
    .limit(1);
  if (waitingError) throw new Error(`query waiting video_script failed: ${waitingError.message}`);

  if (!waiting || waiting.length === 0) {
    console.log("No video_script campaign is currently ready_for_owner/in_review -- nothing to approve/render. A fresh one would need to go through /api/run-campaign (LLM drafting), which this script deliberately does not do.");
    return;
  }

  const asset = waiting[0] as { id: string; campaign_id: string };
  console.log(`Found waiting video_script campaign_asset ${asset.id} (campaign ${asset.campaign_id}) -- approving.`);

  const now = new Date().toISOString();
  const { error: approveError } = await client
    .from("campaigns")
    .update({ status: "approved", updated_at: now, decided_by: "admin-test-script", decided_at: now })
    .eq("id", asset.campaign_id);
  if (approveError) throw new Error(`approve campaign failed: ${approveError.message}`);

  const { error: stageError } = await client.from("campaign_assets").update({ stage: "handed_off" }).eq("id", asset.id);
  if (stageError) throw new Error(`update asset stage failed: ${stageError.message}`);

  const { data: enqueueData, error: enqueueError } = await client.rpc("enqueue_video_render", {
    p_campaign_asset_id: asset.id,
    p_monthly_cap: MAX_VIDEO_RENDERS_PER_MONTH,
    p_daily_cap: MAX_VIDEO_RENDERS_PER_DAY,
  });
  if (enqueueError) throw new Error(`enqueue_video_render failed: ${enqueueError.message}`);
  console.log("enqueue_video_render result:", JSON.stringify(enqueueData));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
