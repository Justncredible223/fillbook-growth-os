import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { constantTimeEquals } from "../src/lib/requireAppAuth.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createSearchConsoleAdapter } from "../src/signals/adapters/searchConsoleAdapter.js";
import { ingestSearchConsoleQueries } from "../src/signals/adapters/searchConsoleIngestion.js";
import { runGenerateOpportunities } from "../src/opportunities/runGenerateOpportunities.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { SupabaseAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository.js";
import { runAutoDraftStep } from "../src/opportunities/autoDraftStep.js";
import { buildSupabaseRunCampaignDeps } from "../src/content/runCampaignForOpportunity.js";
import { runDailyXFeedPostStep } from "../src/content/dailyXFeedPost.js";
import { buildXFeedPostStepDeps } from "../src/content/buildXFeedPostStepDeps.js";
import { getOperatingDate, getScheduleTimezone } from "../src/config/scheduleConfig.js";
import { pruneOldCostEvents } from "../src/cost/costTracking.js";
import { pruneOldVideoRenders } from "../src/video/videoRenderRetention.js";
import { generateStrategy } from "../src/strategy/strategyEngine.js";
import { SupabaseStrategyRepository, collectStrategyEngineInputs } from "../src/strategy/supabaseStrategyRepository.js";
import { decideNotifications } from "../src/notifications/notificationEngine.js";
import { SupabaseNotificationRepository, collectNotificationInputs } from "../src/notifications/supabaseNotificationRepository.js";

const STRATEGY_REGENERATION_INTERVAL_DAYS = 7;
const NOTIFICATION_LOOKBACK_HOURS = 25; // safe margin over the ~24h cron cadence

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * Which of this endpoint's two step groups a given invocation runs.
 * `group=core` (Search Console -> opportunities -> auto-draft -> strategy)
 * and `group=x_feed_post` are two SEPARATE Vercel Cron entries hitting
 * this same file at different times, each getting its own fresh 60s
 * execution budget -- see this file's own doc comment for why sharing one
 * invocation was a real timeout risk. No flag at all (manual run-now via
 * POST, or a future ad-hoc trigger) runs both, same "everything" default
 * growth-pulse.ts's own resolveStepGroups uses.
 */
export function resolveDailyPipelineGroups(query: Record<string, unknown>): { core: boolean; xFeedPost: boolean } {
  if (query.group === undefined) return { core: true, xFeedPost: true };
  return { core: query.group === "core", xFeedPost: query.group === "x_feed_post" };
}

/**
 * Every pipeline step runs through this: a thrown error becomes a visible
 * `ok: false` result with the error's message, never a crash and never a
 * silent success. Exported so the contract ("a step that throws is
 * recorded as failed") is directly testable against real step bodies.
 */
export async function runStep(step: string, fn: () => Promise<string>): Promise<StepResult> {
  try {
    return { step, ok: true, detail: await fn() };
  } catch (err) {
    return { step, ok: false, detail: errorMessage(err) };
  }
}

/**
 * The scheduled entry point for this project's Search-Console ->
 * opportunity -> auto-draft pipeline, AND for the separate daily X
 * feed-post step -- ONE file, but TWO Vercel Cron entries call it with
 * different `?group=` values (see resolveDailyPipelineGroups above),
 * because Vercel's Hobby plan caps cron jobs at 2 total/once-per-day
 * (https://vercel.com/docs/cron-jobs/usage-and-pricing) AND separately
 * caps total serverless functions at 12 (already fully used -- see
 * api/summary.ts's own doc comment), so a genuinely separate *file* for
 * x_feed_post wasn't available; a second *cron entry* pointing at this
 * same file was. Each step runs independently and records its own
 * ok/error -- one source failing (e.g. a token needing re-auth) doesn't
 * block the others or the opportunity generation step, which runs over
 * whatever signals landed regardless.
 *
 * Splitting x_feed_post into its own invocation isn't just tidiness: the
 * `core` group alone (Search Console + opportunity generation + up to 10
 * real auto-draft LLM calls) can already approach this function's 60s
 * ceiling, and x_feed_post can add up to 20 MORE real calls (2 attempts x
 * up to 1 draft + 9 review calls each) in the worst case -- sharing one
 * invocation risked the function timing out before ever reaching
 * x_feed_post, or worse, mid-attempt (see dailyXFeedPost.ts's own
 * doc comment for how a mid-attempt timeout is recovered from safely).
 *
 * x_mentions, inbound_engagement, and prospecting_search moved OUT to
 * api/growth-pulse.ts, which a free external scheduler (GitHub
 * Actions, not a second Vercel cron -- Hobby's cap wouldn't allow one)
 * calls 3x/day (morning/noon/evening) instead of once here. YouTube and
 * TikTok signal ingestion were removed outright (not moved) -- the owner
 * distributes video content through Fliki separately and neither ever
 * fed anything the owner acted on here.
 *
 * Deliberately does NOT call /api/run-campaign. That spends real LLM
 * tokens (1 draft + up to 9 review-agent calls) per attempt, with no
 * cost cap or budget tracking built yet (see the not-started "Cost
 * Intelligence" phase in docs/PROGRESS_LEDGER.md) -- running it
 * automatically, every day, forever, without anyone watching the bill is
 * a real-money decision that should stay a deliberate, visible action for
 * now, not something silently scheduled.
 *
 * Vercel Cron invokes this via GET with an `Authorization: Bearer
 * <CRON_SECRET>` header
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Also accepts POST with the same header for manual triggering.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    res.status(500).json({ error: "CRON_SECRET is not configured on the server" });
    return;
  }
  if (!req.headers.authorization || !constantTimeEquals(req.headers.authorization, `Bearer ${cronSecret}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // This invocation's own real start time -- used to derive a hard
  // deadline for the x_feed_post step (see below) so "does this fit in
  // 60s" is measured against THIS invocation's actual elapsed time, not
  // assumed. vercel.json's maxDuration for this file is 60s; the 8s
  // margin covers the notifications step (which always runs after,
  // regardless of group) plus response serialization.
  const invocationStartedAt = Date.now();
  const INVOCATION_SAFETY_MARGIN_MS = 8_000;

  const client = getServiceClient();
  const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));
  const groups = resolveDailyPipelineGroups(req.query as Record<string, unknown>);

  const results: StepResult[] = [];

  if (groups.core) {
    results.push(
      await runStep("cost_events_retention", async () => pruneOldCostEvents(client)),
      await runStep("video_render_retention", async () => pruneOldVideoRenders(client)),
      await runStep("search_console", async () => {
        const adapter = createSearchConsoleAdapter(client);
        const siteUrl = await adapter.resolveSiteUrl();
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() - 3);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 7);
        const signals = await ingestSearchConsoleQueries(
          adapter,
          signalGraph,
          siteUrl,
          isoDate(startDate),
          isoDate(endDate),
          now,
        );
        return `${signals.length} ingested`;
      }),
      await runStep("generate_opportunities", async () => {
        const result = await runGenerateOpportunities(client);
        return `${result.created} created, ${result.skipped} skipped`;
      }),
      await runStep("auto_draft", async () => {
        const now = new Date();
        const runDate = isoDate(now);
        let currentOpportunityId = "unknown";

        const { deps: runCampaignDeps, usage } = await buildSupabaseRunCampaignDeps(
          client,
          () => currentOpportunityId,
          "auto-draft",
        );

        const result = await runAutoDraftStep(
          {
            runCampaignDeps,
            usageLog: usage.usages,
            opportunityRepo: new SupabaseOpportunityRepository(client),
            runRepo: new SupabaseAutoDraftRunRepository(client),
            countReadyForOwnerAssets: async () => {
              const { count, error } = await client
                .from("campaign_assets")
                .select("id", { count: "exact", head: true })
                .eq("stage", "ready_for_owner");
              if (error) throw error;
              return count ?? 0;
            },
            listOpportunityIdsWithCampaigns: async () => {
              const { data, error } = await client.from("campaigns").select("opportunity_id");
              if (error) throw error;
              return new Set(((data ?? []) as Array<{ opportunity_id: string | null }>).map((r) => r.opportunity_id).filter((id): id is string => Boolean(id)));
            },
            isPaused: async () => {
              const { data } = await client.from("system_settings").select("paused").eq("id", true).single();
              return data?.paused ?? false;
            },
            onOpportunitySelected: (id) => {
              currentOpportunityId = id;
            },
          },
          runDate,
          now,
        );

        if (result.status === "drafted") {
          return `drafted (opportunity ${result.opportunityId}, ${result.aiCalls} AI calls, $${result.costUsd.toFixed(6)})`;
        }
        if (result.status === "skipped") {
          return `skipped -- ${result.skipReason}`;
        }
        if (result.status === "already_ran") {
          return "already ran today -- idempotent skip";
        }
        throw new Error(result.error ?? "auto-draft failed for an unknown reason");
      }),
      // Safe to run automatically, unlike auto_draft: pure aggregation over
      // this project's own already-collected data, no LLM/AI cost. Weekly
      // per the master spec ("weekly strategy engine"), not daily -- checks
      // the latest saved version's age rather than tracking its own
      // separate schedule state, so a missed cron run just means the next
      // one catches up instead of drifting.
      await runStep("strategy_evolution", async () => {
        const now = new Date();
        const strategyRepo = new SupabaseStrategyRepository(client);
        const latest = await strategyRepo.getLatest();
        if (latest) {
          const ageDays = (now.getTime() - new Date(latest.generatedAt).getTime()) / (1000 * 60 * 60 * 24);
          if (ageDays < STRATEGY_REGENERATION_INTERVAL_DAYS) {
            return `skipped -- last version is ${ageDays.toFixed(1)}d old, regenerates every ${STRATEGY_REGENERATION_INTERVAL_DAYS}d`;
          }
        }
        const inputs = await collectStrategyEngineInputs(client, now);
        const recommendation = generateStrategy(inputs);
        const saved = await strategyRepo.save(recommendation);
        return `generated version ${saved.version} (lowConfidence=${saved.lowConfidence})`;
      }),
    );
  }

  if (groups.xFeedPost) {
    // Guarantees Home has a genuine X feed post for today, independent of
    // whether any signal-derived opportunity happened to clear
    // auto-draft's score threshold in the `core` group above -- see
    // dailyXFeedPost.ts's own doc comment for why that dependency was the
    // root cause of "Today's X Post" sitting empty for days at a time. A
    // failed attempt here is recorded and visibly retryable (Home's
    // "Regenerate"), never a silent empty state, and never blocks or is
    // blocked by auto_draft -- structurally guaranteed now by running in
    // its own invocation entirely, not just its own try/catch.
    results.push(
      await runStep("x_feed_post", async () => {
        const now = new Date();
        const operatingDate = getOperatingDate(now, getScheduleTimezone());
        const { deps } = await buildXFeedPostStepDeps(client);
        // maxDuration is 60s for THIS FILE regardless of which group is
        // running -- when x_feed_post shares an invocation with `core`
        // (the no-`group` manual/legacy path), core's own steps have
        // already consumed real time by this point, so the deadline is
        // computed from the invocation's actual start, not a fresh 60s.
        const deadlineMs = invocationStartedAt + 60_000 - INVOCATION_SAFETY_MARGIN_MS;
        const result = await runDailyXFeedPostStep(deps, operatingDate, false, now, deadlineMs);

        if (result.status === "ready") {
          return `ready (topic ${result.topicKey}, ${result.attempts} attempt(s), ${result.aiCalls} AI calls, $${result.costUsd.toFixed(6)})`;
        }
        if (result.status === "skipped") {
          return `skipped -- ${result.skipReason}`;
        }
        throw new Error(result.error ?? "x-feed-post generation failed for an unknown reason");
      }),
    );
  }

  // Runs last, over THIS invocation's own results plus real DB state --
  // never fires for routine/expected activity, only for what the master
  // spec calls "meaningful events." Runs in both the `core` and
  // `x_feed_post` invocations (not just once/day) -- collectNotificationInputs
  // already de-dupes on related_id, so this is a safe, idempotent no-op
  // for whichever group didn't produce anything notification-worthy, and
  // means a failure in EITHER invocation is surfaced without waiting for
  // the other one to also run. See notificationEngine.ts's own "avoid
  // spam" discipline.
  const notificationsResult = await runStep("notifications", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - NOTIFICATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const failedSteps = results.filter((r) => !r.ok).map((r) => ({ step: r.step, detail: r.detail }));
    const inputs = await collectNotificationInputs(client, failedSteps, since);
    const toCreate = decideNotifications(inputs);
    const notifRepo = new SupabaseNotificationRepository(client);
    for (const notif of toCreate) {
      await notifRepo.create(notif);
    }
    return `${toCreate.length} created`;
  });
  results.push(notificationsResult);

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({ results, ranGroups: groups });
}
