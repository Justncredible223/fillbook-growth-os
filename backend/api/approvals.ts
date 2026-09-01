import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

/**
 * Assembles ApprovalAsset-shaped rows (matching the Android app's data
 * model) from campaign_assets currently at 'ready_for_owner', joined with
 * their campaign's thesis and their latest content_versions body. Two
 * queries rather than one complex join -- volume here is low (single-owner
 * app), so simplicity wins over a single round trip.
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
      .select("id, platform, asset_type, campaigns(thesis)")
      .eq("stage", "ready_for_owner");
    if (assetsError) throw assetsError;

    const approvals = await Promise.all(
      (assets ?? []).map(async (asset: any) => {
        const { data: latestVersion } = await client
          .from("content_versions")
          .select("body")
          .eq("campaign_asset_id", asset.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        return {
          id: asset.id,
          campaignTitle: asset.campaigns?.thesis ?? "(untitled campaign)",
          platform: asset.platform,
          assetType: asset.asset_type,
          previewText: latestVersion?.body ?? "",
          stage: "READY_FOR_OWNER",
        };
      }),
    );

    res.status(200).json({ approvals });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
