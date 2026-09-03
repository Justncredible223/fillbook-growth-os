import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { MONTHLY_AUTO_DRAFT_BUDGET_USD, BACKLOG_CAP } from "../src/opportunities/autoDraftEligibility.js";
import { SupabaseAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

/**
 * POST here is the Pause System control (Settings/System screens):
 * { paused: boolean }. Folded into this GET endpoint rather than a new
 * file -- this project is already at Vercel Hobby's 12-serverless-
 * function cap (see ingest.ts/daily-pipeline.ts), same reasoning as
 * approvals.ts combining its own GET/POST. Actually enforced, not just
 * a display value: see autoDraftStep.ts's isPaused dep and
 * run-campaign.ts's own check -- both real money-spending paths stop
 * when this is true.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;

  if (req.method === "POST") {
    try {
      const paused = (req.body as { paused?: boolean } | undefined)?.paused;
      if (typeof paused !== "boolean") {
        res.status(400).json({ error: "Body must be { paused: boolean }" });
        return;
      }
      const client = getServiceClient();
      const { error } = await client
        .from("system_settings")
        .update({ paused, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (error) throw error;
      res.status(200).json({ paused });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

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

    const [signalsToday, openOpportunities, readyAssetsAwaitingDecision, settings, signalsBySource, opportunitiesByStatus, assetsByStage, costRows, lastAutoDraftRun, monthAutoDraftSpendUsd, xAssetsToday] =
      await Promise.all([
        client.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", startOfToday.toISOString()),
        client.from("opportunities").select("id", { count: "exact", head: true }).eq("status", "open"),
        // Same filter as GET /api/approvals: ready_for_owner AND the
        // campaign is still in_review. Counting ready_for_owner alone
        // (the old behavior) overcounted -- an asset can sit at
        // ready_for_owner after its campaign has already been approved
        // or retired, which /api/approvals correctly excludes but this
        // count previously didn't, so Home showed "N waiting on you"
        // while Approvals showed fewer (or zero) real decisions pending.
        client
          .from("campaign_assets")
          .select("id, campaigns!inner(status)", { count: "exact", head: true })
          .eq("stage", "ready_for_owner")
          .eq("campaigns.status", "in_review"),
        client.from("system_settings").select("paused").eq("id", true).single(),
        client.from("signals").select("source"),
        client.from("opportunities").select("status"),
        client.from("campaign_assets").select("stage"),
        client.from("cost_events").select("cost_usd"),
        autoDraftRunRepo.getLastRun(),
        autoDraftRunRepo.getMonthSpendUsd(yearMonth),
        // Today's X Post: real candidates only -- an X-platform asset
        // actually created today, at a stage the owner can act on or has
        // already acted on. Never assumes Auto-Draft targeted X; this is
        // independent of which pipeline produced it.
        client
          .from("campaign_assets")
          .select("id, stage, campaign_id, campaigns!inner(status)")
          .eq("platform", "x")
          .gte("created_at", startOfToday.toISOString())
          .in("stage", ["ready_for_owner", "handed_off"])
          .order("created_at", { ascending: false }),
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

    // A handed-off asset (owner already opened X with it) outranks a
    // still-pending ready one -- if both exist, the story is "already
    // handled today," not "still waiting."
    type XAssetRow = { id: string; stage: string; campaign_id: string; campaigns: { status: string } | { status: string }[] };
    const xCandidates = (xAssetsToday.data ?? []) as XAssetRow[];
    const statusOf = (row: XAssetRow): string | undefined =>
      Array.isArray(row.campaigns) ? row.campaigns[0]?.status : row.campaigns?.status;
    const handedOff = xCandidates.find((a) => a.stage === "handed_off");
    const readyForOwner = xCandidates.find((a) => a.stage === "ready_for_owner" && statusOf(a) === "in_review");
    const chosenXAsset = handedOff ?? readyForOwner ?? null;

    let todayXPost: { state: "empty" | "ready" | "handed_off"; campaignAssetId?: string; previewText?: string } = { state: "empty" };
    if (chosenXAsset?.stage === "handed_off") {
      todayXPost = { state: "handed_off", campaignAssetId: chosenXAsset.id };
    } else if (chosenXAsset) {
      const { data: latestVersion } = await client
        .from("content_versions")
        .select("body")
        .eq("campaign_asset_id", chosenXAsset.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      todayXPost = { state: "ready", campaignAssetId: chosenXAsset.id, previewText: latestVersion?.body ?? "" };
    }

    res.status(200).json({
      todayXPost,
      signalsAnalyzedToday: signalsToday.count ?? 0,
      opportunitiesFound: openOpportunities.count ?? 0,
      assetsReady: readyAssetsAwaitingDecision.count ?? 0,
      // Same real, in_review-filtered count GET /api/approvals returns --
      // guarantees Home and Approvals always agree on "how many."
      pendingReview: readyAssetsAwaitingDecision.count ?? 0,
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
          backlogCount: readyAssetsAwaitingDecision.count ?? 0,
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
