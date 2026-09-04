import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

/**
 * Read-only view of every campaign this system has actually run, for the
 * Android Campaigns screen -- the full pipeline history (including
 * rejected drafts still sitting at draft/final_draft), not just what
 * reached ready_for_owner (that subset is /api/approvals). Three queries
 * rather than a single deep join -- same "simplicity wins over one round
 * trip" reasoning as /api/approvals, at this volume.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const { data: campaignRows, error: campaignsError } = await client
      .from("campaigns")
      .select("id, thesis, status, created_at, decided_by, decided_at")
      .order("created_at", { ascending: false });
    if (campaignsError) throw campaignsError;

    const campaigns = await Promise.all(
      (campaignRows ?? []).map(async (campaign: any) => {
        const { data: assetRows, error: assetsError } = await client
          .from("campaign_assets")
          .select("id, platform, asset_type, stage")
          .eq("campaign_id", campaign.id);
        if (assetsError) throw assetsError;

        const assets = await Promise.all(
          (assetRows ?? []).map(async (asset: any) => {
            const { data: latestVersion } = await client
              .from("content_versions")
              .select("id, body")
              .eq("campaign_asset_id", asset.id)
              .order("version", { ascending: false })
              .limit(1)
              .maybeSingle();

            let passCount = 0;
            let failCount = 0;
            const failReasons: Array<{ evaluator: string; verdict: string; notes: string | null }> = [];
            if (latestVersion) {
              const { data: scores } = await client
                .from("content_scores")
                .select("evaluator, verdict, notes")
                .eq("content_version_id", latestVersion.id);
              for (const row of (scores ?? []) as Array<{ evaluator: string; verdict: string; notes: string | null }>) {
                if (row.verdict === "pass") {
                  passCount++;
                } else {
                  failCount++;
                  failReasons.push({ evaluator: row.evaluator, verdict: row.verdict, notes: row.notes });
                }
              }
            }

            return {
              id: asset.id,
              platform: asset.platform,
              assetType: asset.asset_type,
              stage: asset.stage,
              latestBody: latestVersion?.body ?? null,
              reviewPassCount: passCount,
              reviewFailCount: failCount,
              // Why a final_draft asset never reached the owner -- empty for
              // anything that passed every reviewer or hasn't been scored yet.
              failReasons,
            };
          }),
        );

        return {
          id: campaign.id,
          thesis: campaign.thesis,
          status: campaign.status,
          decidedBy: campaign.decided_by ?? null,
          decidedAt: campaign.decided_at ?? null,
          assets,
        };
      }),
    );

    res.status(200).json({ campaigns });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
