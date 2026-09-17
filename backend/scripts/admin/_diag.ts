import { getServiceClient } from "../../src/lib/supabaseClient.js";

async function main() {
  const client = getServiceClient();
  const { data: opps, error: oppError } = await client
    .from("opportunities")
    .select("id, title")
    .ilike("title", "%journal%")
    .order("created_at", { ascending: false })
    .limit(10);
  if (oppError) throw new Error(oppError.message);
  console.log("opportunities matching 'journal':", JSON.stringify(opps, null, 2));

  const oppIds = (opps ?? []).map((o: any) => o.id);
  if (oppIds.length === 0) return;

  const { data: campaigns, error: campError } = await client
    .from("campaigns")
    .select("id, opportunity_id, status, created_at")
    .in("opportunity_id", oppIds)
    .order("created_at", { ascending: false });
  if (campError) throw new Error(campError.message);
  console.log("campaigns:", JSON.stringify(campaigns, null, 2));

  const campaignIds = (campaigns ?? []).map((c: any) => c.id);
  if (campaignIds.length === 0) return;

  const { data: assets, error: assetError } = await client
    .from("campaign_assets")
    .select("id, campaign_id, asset_type, stage, created_at")
    .in("campaign_id", campaignIds)
    .eq("asset_type", "video_script")
    .order("created_at", { ascending: false });
  if (assetError) throw new Error(assetError.message);
  console.log("video_script assets:", JSON.stringify(assets, null, 2));

  for (const asset of assets ?? []) {
    const { data: versions } = await client
      .from("content_versions")
      .select("id, version")
      .eq("campaign_asset_id", (asset as any).id)
      .order("version", { ascending: false })
      .limit(1);
    const latestVersion = (versions ?? [])[0] as any;
    if (!latestVersion) continue;
    const { data: scores } = await client
      .from("content_scores")
      .select("evaluator, verdict, score, notes")
      .eq("content_version_id", latestVersion.id)
      .eq("verdict", "fail");
    console.log(`--- fail reasons for asset ${(asset as any).id} ---`);
    for (const s of scores ?? []) {
      console.log(`[${(s as any).evaluator}] ${(s as any).notes}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
