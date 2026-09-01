import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

/**
 * Assembles ApprovalAsset-shaped rows (matching the Android app's data
 * model) from campaign_assets currently at 'ready_for_owner', joined with
 * their campaign's thesis and their latest content_versions body. Also
 * flags which ones were produced by the unattended daily auto-draft step
 * (api/daily-pipeline.ts) rather than a manual /api/run-campaign call, by
 * checking auto_draft_runs.campaign_id -- the same row that already
 * records that run's real cost and timestamp, so no extra bookkeeping.
 * Auto-generated does NOT mean approved: every row here is still only
 * 'in_review' at the campaign level, waiting for a human to actually look.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const { data: assets, error: assetsError } = await client
      .from("campaign_assets")
      .select("id, platform, asset_type, campaign_id, campaigns(thesis)")
      .eq("stage", "ready_for_owner");
    if (assetsError) throw assetsError;

    const { data: autoDraftRuns, error: autoDraftError } = await client
      .from("auto_draft_runs")
      .select("campaign_id, cost_usd, created_at")
      .eq("status", "drafted");
    if (autoDraftError) throw autoDraftError;
    const autoDraftByCampaignId = new Map(
      ((autoDraftRuns ?? []) as Array<{ campaign_id: string | null; cost_usd: number | null; created_at: string }>)
        .filter((r) => r.campaign_id)
        .map((r) => [r.campaign_id as string, r]),
    );

    const approvals = await Promise.all(
      (assets ?? []).map(async (asset: any) => {
        const { data: latestVersion } = await client
          .from("content_versions")
          .select("body")
          .eq("campaign_asset_id", asset.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        const autoDraft = autoDraftByCampaignId.get(asset.campaign_id);

        return {
          id: asset.id,
          campaignTitle: asset.campaigns?.thesis ?? "(untitled campaign)",
          platform: asset.platform,
          assetType: asset.asset_type,
          previewText: latestVersion?.body ?? "",
          stage: "READY_FOR_OWNER",
          isAutoDraft: Boolean(autoDraft),
          costUsd: autoDraft ? Number(autoDraft.cost_usd ?? 0) : null,
          generatedAt: autoDraft ? autoDraft.created_at : null,
        };
      }),
    );

    res.status(200).json({ approvals });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
