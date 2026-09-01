import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [signalsToday, openOpportunities, readyAssets, pendingApprovals, settings, signalsBySource, opportunitiesByStatus, assetsByStage, costRows] =
      await Promise.all([
        client.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", startOfToday.toISOString()),
        client.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "open"),
        client.from("campaign_assets").select("id", { count: "exact", head: true }).eq("stage", "ready_for_owner"),
        client.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        client.from("system_settings").select("paused").eq("id", true).single(),
        client.from("signals").select("source"),
        client.from("opportunities").select("status"),
        client.from("campaign_assets").select("stage"),
        client.from("cost_events").select("cost_usd"),
      ]);

    const countBy = (rows: Array<Record<string, string>> | null, key: string): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const row of rows ?? []) {
        const value = row[key] ?? "unknown";
        counts[value] = (counts[value] ?? 0) + 1;
      }
      return counts;
    };
    const totalCostUsd = (costRows.data ?? []).reduce((sum: number, r: { cost_usd: number }) => sum + Number(r.cost_usd), 0);

    res.status(200).json({
      signalsAnalyzedToday: signalsToday.count ?? 0,
      opportunitiesFound: openOpportunities.count ?? 0,
      assetsReady: readyAssets.count ?? 0,
      pendingReview: pendingApprovals.count ?? 0,
      systemPaused: settings.data?.paused ?? false,
      analytics: {
        totalSignals: (signalsBySource.data ?? []).length,
        signalsBySource: countBy(signalsBySource.data as Array<Record<string, string>>, "source"),
        opportunitiesByStatus: countBy(opportunitiesByStatus.data as Array<Record<string, string>>, "status"),
        campaignAssetsByStage: countBy(assetsByStage.data as Array<Record<string, string>>, "stage"),
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
