import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { MONTHLY_AUTO_DRAFT_BUDGET_USD, BACKLOG_CAP } from "../src/opportunities/autoDraftEligibility.js";
import { SupabaseAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";
import { generateStrategy } from "../src/strategy/strategyEngine.js";
import { SupabaseStrategyRepository, collectStrategyEngineInputs } from "../src/strategy/supabaseStrategyRepository.js";
import { interpretExperiment } from "../src/experiments/experimentEngine.js";
import { SupabaseExperimentRepository, measureExperiment } from "../src/experiments/supabaseExperimentRepository.js";
import type { NewExperiment } from "../src/experiments/types.js";
import { SupabaseNotificationRepository } from "../src/notifications/supabaseNotificationRepository.js";
import { getTodaySpendUsd } from "../src/cost/costTracking.js";

/**
 * `?resource=strategy` handles Strategy Evolution -- a read of the latest
 * versioned report (GET) or forcing a fresh one (POST). Folded in here
 * for the same 12-function-cap reason as everything else in this file.
 * See docs/PROGRESS_LEDGER.md and backend/src/strategy/types.ts.
 */
async function handleStrategy(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = getServiceClient();
  const repo = new SupabaseStrategyRepository(client);

  if (req.method === "GET") {
    try {
      if (req.query.history === "1") {
        res.status(200).json({ versions: await repo.listHistory(20) });
        return;
      }
      res.status(200).json({ strategy: await repo.getLatest() });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const now = new Date();
    const inputs = await collectStrategyEngineInputs(client, now);
    const recommendation = generateStrategy(inputs);
    const saved = await repo.save(recommendation);
    res.status(200).json({ strategy: saved });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * `?resource=experiments` -- before/after content-performance tests (see
 * backend/src/experiments/types.ts for why "control vs treatment" means
 * time periods here, not a randomized split). GET lists all; POST with
 * no `id` creates+starts one; POST with `{ id, action: "measure" }`
 * computes/refreshes its result without ending it; POST with
 * `{ id, action: "complete" }` computes a final result and closes it;
 * POST with `{ id, action: "abort" }` cancels one early. Folded in here
 * for the same 12-function-cap reason as strategy above.
 */
async function handleExperiments(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = getServiceClient();
  const repo = new SupabaseExperimentRepository(client);

  if (req.method === "GET") {
    try {
      res.status(200).json({ experiments: await repo.list() });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as
      | { id?: string; action?: string; hypothesis?: string; scope?: { platform?: string; assetType?: string }; guardrailNote?: string; startDate?: string; controlWindowDays?: number }
      | undefined;

    if (!body?.id) {
      if (!body?.hypothesis || !body?.startDate) {
        res.status(400).json({ error: "Body must include { hypothesis, startDate } to create an experiment" });
        return;
      }
      const input: NewExperiment = {
        hypothesis: body.hypothesis,
        scope: body.scope ?? {},
        guardrailNote: body.guardrailNote ?? null,
        startDate: body.startDate,
        controlWindowDays: body.controlWindowDays ?? 14,
      };
      const created = await repo.create(input);
      res.status(200).json({ experiment: created });
      return;
    }

    const experiment = await repo.get(body.id);
    if (!experiment) {
      res.status(404).json({ error: "Experiment not found" });
      return;
    }

    if (body.action === "abort") {
      await repo.abort(body.id);
      res.status(200).json({ id: body.id, status: "aborted" });
      return;
    }

    if (body.action === "measure" || body.action === "complete") {
      const now = new Date();
      const { control, treatment } = await measureExperiment(client, experiment, now);
      const result = interpretExperiment(control, treatment, now);

      if (body.action === "complete") {
        const completed = await repo.complete(body.id, result, now.toISOString().slice(0, 10));
        res.status(200).json({ experiment: completed });
        return;
      }
      res.status(200).json({ experiment: { ...experiment, result } });
      return;
    }

    res.status(400).json({ error: "action must be one of: measure, complete, abort" });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * `?resource=notifications` -- the real in-app Notification System (see
 * backend/src/notifications/notificationEngine.ts). GET lists recent
 * notifications + unread count; POST { id, action: "mark-read" } or
 * { action: "mark-all-read" }. In-app only, not OS-level push -- that
 * needs a Firebase Cloud Messaging project (a new external service the
 * owner would have to set up), not attempted without that owner action.
 */
async function handleNotifications(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = getServiceClient();
  const repo = new SupabaseNotificationRepository(client);

  if (req.method === "GET") {
    try {
      const [notifications, unreadCount] = await Promise.all([repo.list(50), repo.countUnread()]);
      res.status(200).json({ notifications, unreadCount });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as { id?: string; action?: string } | undefined;
    if (body?.action === "mark-all-read") {
      await repo.markAllRead();
      res.status(200).json({ ok: true });
      return;
    }
    if (body?.action === "mark-read" && body.id) {
      await repo.markRead(body.id);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ error: "action must be 'mark-read' (with id) or 'mark-all-read'" });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * `?resource=brief` (Morning Brief) and `?resource=evening-report`
 * (Evening Report) -- both computed on read from real data, not stored
 * separately, since there's nothing to store that isn't already a
 * snapshot of other tables. "Overnight"/"today" both mean the trailing
 * 24h from the request time, not a calendar-day boundary -- simpler and
 * correct regardless of which timezone the owner is actually in.
 */
async function handleBrief(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const client = getServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [signalsSince, newOpportunities, pendingApprovals, inboundSummaryRow, strategy, unreadNotifications] = await Promise.all([
      client.from("signals").select("id", { count: "exact", head: true }).gte("observed_at", since),
      client.from("opportunities").select("id, title, score").eq("status", "open").gte("created_at", since).order("score", { ascending: false }).limit(5),
      client.from("campaign_assets").select("id, campaigns!inner(status)", { count: "exact", head: true }).eq("stage", "ready_for_owner").eq("campaigns.status", "in_review"),
      client.from("inbound_engagements").select("status"),
      new SupabaseStrategyRepository(client).getLatest(),
      client.from("notifications").select("id, title, severity").is("read_at", null).order("created_at", { ascending: false }).limit(5),
    ]);

    const needsResponse = ((inboundSummaryRow.data ?? []) as Array<{ status: string }>).filter(
      (r) => r.status === "needs_response" || r.status === "review_needed" || r.status === "draft_ready",
    ).length;

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      signalsOvernight: signalsSince.count ?? 0,
      topNewOpportunities: (newOpportunities.data ?? []).map((o: any) => ({ id: o.id, title: o.title, score: Number(o.score) })),
      pendingApprovals: pendingApprovals.count ?? 0,
      inboundNeedsResponse: needsResponse,
      strategySummary: strategy?.summary ?? null,
      unreadNotifications: unreadNotifications.data ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

async function handleEveningReport(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const client = getServiceClient();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [assetsDrafted, decidedToday, scoresToday, costToday, inboundResolvedToday, topCampaign] = await Promise.all([
      client.from("campaign_assets").select("id", { count: "exact", head: true }).gte("created_at", since),
      client.from("campaigns").select("status").gte("decided_at", since),
      client.from("content_scores").select("verdict").gte("created_at", since),
      client.from("cost_events").select("cost_usd").gte("created_at", since),
      client.from("inbound_engagements").select("id", { count: "exact", head: true }).gte("responded_at", since),
      client.from("opportunities").select("title, score").gte("created_at", since).order("score", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const decided = (decidedToday.data ?? []) as Array<{ status: string }>;
    const approvedCount = decided.filter((c) => c.status === "approved").length;
    const rejectedCount = decided.filter((c) => c.status === "retired").length;

    const scores = (scoresToday.data ?? []) as Array<{ verdict: string }>;
    const passCount = scores.filter((s) => s.verdict === "pass").length;
    const reviewPassRate = scores.length > 0 ? passCount / scores.length : null;

    const totalCostToday = (costToday.data ?? []).reduce((sum: number, r: { cost_usd: number }) => sum + Number(r.cost_usd), 0);

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      assetsDrafted: assetsDrafted.count ?? 0,
      approvedToday: approvedCount,
      rejectedToday: rejectedCount,
      reviewPassRate,
      costTodayUsd: Number(totalCostToday.toFixed(6)),
      inboundResolvedToday: inboundResolvedToday.count ?? 0,
      topOpportunity: topCampaign.data ? { title: (topCampaign.data as any).title, score: Number((topCampaign.data as any).score) } : null,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * POST here (default resource) is the Pause System control (Settings/
 * System screens): { paused: boolean }. Folded into this GET endpoint
 * rather than a new file -- this project is already at Vercel Hobby's
 * 12-serverless-function cap (see ingest.ts/daily-pipeline.ts), same
 * reasoning as approvals.ts combining its own GET/POST. Actually
 * enforced, not just a display value: see autoDraftStep.ts's isPaused
 * dep and run-campaign.ts's own check -- both real money-spending paths
 * stop when this is true.
 */
/**
 * Folded in from the former api/cost-summary.ts (`GET /api/summary?view=cost`)
 * to free a serverless-function slot for api/reddit-pulse.ts -- this
 * project was discovered to be already AT Vercel Hobby's 12-function cap
 * (see this file's own doc comment below), and the in-progress
 * prospecting-pulse.ts split had silently pushed it to 13 (a real,
 * previously-uncaught deploy-breaking bug, same failure mode documented in
 * docs/PROGRESS_LEDGER.md Phase 15 -- a successful build that then fails
 * silently at the "Deploying outputs..." step). Response shape is
 * byte-for-byte identical to the old endpoint; only the URL changed
 * (Android's NetworkGrowthOsRepository.getCostSummary() updated to match).
 */
async function handleCostSummary(res: VercelResponse): Promise<void> {
  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("cost_events")
      .select("cost_usd, input_tokens, output_tokens, model, created_at");
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      model: string;
      created_at: string;
    }>;

    const totalCostUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
    const totalInputTokens = rows.reduce((sum, r) => sum + r.input_tokens, 0);
    const totalOutputTokens = rows.reduce((sum, r) => sum + r.output_tokens, 0);

    const last24hCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const last24hCostUsd = rows
      .filter((r) => r.created_at >= last24hCutoff)
      .reduce((sum, r) => sum + Number(r.cost_usd), 0);

    res.status(200).json({
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      last24hCostUsd: Number(last24hCostUsd.toFixed(6)),
      totalCalls: rows.length,
      totalInputTokens,
      totalOutputTokens,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;

  if (req.query.resource === "strategy") {
    await handleStrategy(req, res);
    return;
  }
  if (req.query.resource === "experiments") {
    await handleExperiments(req, res);
    return;
  }
  if (req.query.resource === "notifications") {
    await handleNotifications(req, res);
    return;
  }
  if (req.query.resource === "brief") {
    await handleBrief(req, res);
    return;
  }
  if (req.query.resource === "evening-report") {
    await handleEveningReport(req, res);
    return;
  }
  if (req.method === "GET" && req.query.view === "cost") {
    await handleCostSummary(res);
    return;
  }

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

    const [signalsToday, openOpportunities, readyAssetsAwaitingDecision, settings, signalsBySource, opportunitiesByStatus, assetsByStage, costRows, lastAutoDraftRun, monthAutoDraftSpendUsd, xAssetsToday, todaySpendUsd] =
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
        getTodaySpendUsd(client),
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
        // Properly date-scoped (today, UTC calendar day, all providers) --
        // see getTodaySpendUsd's doc comment. totalCostUsd above is
        // lifetime and deliberately left as-is for the screens that
        // already correctly label it "Total"/"LLM spend" (AnalyticsScreen,
        // SystemScreen) -- only Home's "Today's spend" tile was wired to
        // the wrong field, and now reads todaySpendUsd instead.
        todaySpendUsd: Number(todaySpendUsd.toFixed(6)),
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
