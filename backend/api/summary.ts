import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getServiceClient } from "../src/lib/supabaseClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [signalsToday, openOpportunities, readyAssets, pendingApprovals, settings] = await Promise.all([
      client.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", startOfToday.toISOString()),
      client.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "open"),
      client.from("campaign_assets").select("id", { count: "exact", head: true }).eq("stage", "ready_for_owner"),
      client.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      client.from("system_settings").select("paused").eq("id", true).single(),
    ]);

    res.status(200).json({
      signalsAnalyzedToday: signalsToday.count ?? 0,
      opportunitiesFound: openOpportunities.count ?? 0,
      assetsReady: readyAssets.count ?? 0,
      pendingReview: pendingApprovals.count ?? 0,
      systemPaused: settings.data?.paused ?? false,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
