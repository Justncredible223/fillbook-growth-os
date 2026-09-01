import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { MONTHLY_AUTO_DRAFT_BUDGET_USD, BACKLOG_CAP } from "../src/opportunities/autoDraftEligibility.js";
import { SupabaseAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const yearMonth = new Date().toISOString().slice(0, 7);

    const autoDraftRunRepo = new SupabaseAutoDraftRunRepository(client);

    const [signalsToday, openOpportunities, readyAssets, settings, signalsBySource, opportunitiesByStatus, assetsByStage, costRows, lastAutoDraftRun, monthAutoDraftSpendUsd] =
      await Promise.all([
        client.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", startOfToday.toISOString()),
        client.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "open"),
        client.from("campaign_assets").select("id", { count: "exact", head: true }).eq("stage", "ready_for_owner"),
        client.from("system_settings").select("paused").eq("id", true).single(),
        client.from("signals").select("source"),
        client.from("opportunities").select("status"),
        client.from("campaign_assets").select("stage"),
        client.from("cost_events").select("cost_usd"),
        autoDraftRunRepo.getLastRun(),
        autoDraftRunRepo.getMonthSpendUsd(yearMonth),
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
      // Real ready_for_owner count -- NOT the unused `approvals` table
      // (nothing in this codebase ever inserts into it; querying it here
      // always silently returned 0 regardless of real pending drafts).
      pendingReview: readyAssets.count ?? 0,
      systemPaused: settings.data?.paused ?? false,
      analytics: {
        totalSignals: (signalsBySource.data ?? []).length,
        signalsBySource: countBy(signalsBySource.data as Array<Record<string, string>>, "source"),
        opportunitiesByStatus: countBy(opportunitiesByStatus.data as Array<Record<string, string>>, "status"),
        campaignAssetsByStage: countBy(assetsByStage.data as Array<Record<string, string>>, "stage"),
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        autoDraft: {
          lastRunDate: lastAutoDraftRun?.runDate ?? null,
          lastRunStatus: lastAutoDraftRun?.status ?? null,
          lastRunSkipReason: lastAutoDraftRun?.skipReason ?? null,
          backlogCount: readyAssets.count ?? 0,
          backlogCap: BACKLOG_CAP,
          monthSpendUsd: Number(monthAutoDraftSpendUsd.toFixed(6)),
          monthBudgetUsd: MONTHLY_AUTO_DRAFT_BUDGET_USD,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
