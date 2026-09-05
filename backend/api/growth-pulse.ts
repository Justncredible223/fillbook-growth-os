import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { createXSignalAdapter } from "../src/signals/adapters/xAdapter.js";
import { SupabaseIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore.js";
import { ingestXMentions } from "../src/signals/adapters/xIngestion.js";
import { ingestInboundMentions } from "../src/inbound/inboundIngestion.js";
import { SupabaseInboundRepository } from "../src/inbound/supabaseInboundRepository.js";
import { findCreatorIdByHandle } from "../src/creators/supabaseCreatorRepository.js";
import { recordSyncAttempt, recordSyncSuccess, recordSyncFailure } from "../src/lib/integrationHealth.js";
import { runProspectingSearch } from "../src/prospecting/prospectingSearch.js";
import { SupabaseProspectingRepository } from "../src/prospecting/supabaseProspectingRepository.js";
import { getProspectingMonthSpendUsd } from "../src/cost/costTracking.js";
import { createRedditSignalAdapter } from "../src/signals/adapters/redditAdapter.js";
import { ingestRedditInboundMentions } from "../src/inbound/redditIngestion.js";
import { runRedditProspectingSearch } from "../src/prospecting/redditProspectingSearch.js";
import { runPartnershipDiscoveryStep } from "../src/partnerships/discovery.js";

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

async function runStep(step: string, fn: () => Promise<string>): Promise<StepResult> {
  try {
    return { step, ok: true, detail: await fn() };
  } catch (err) {
    return { step, ok: false, detail: errorMessage(err) };
  }
}

export interface StepGroups {
  x: boolean;
  redditInbound: boolean;
  redditProspecting: boolean;
  partnerships: boolean;
}

/**
 * Pure query-string -> step-group decision, pulled out of the handler so
 * it's directly unit-testable (see test/growthPulseStepGroups.test.ts)
 * without needing a real VercelRequest/VercelResponse. See this file's
 * main doc comment for why this is flag-driven rather than wall-clock
 * inference: the caller (.github/workflows/growth-pulse.yml) already knows
 * exactly which scheduled slot it is, so it passes that directly instead
 * of this endpoint re-deriving the same fact from `now`. No flags present
 * at all -- e.g. a bare manual POST while debugging -- runs every group.
 */
export function resolveStepGroups(query: Record<string, unknown>): StepGroups {
  const isTrue = (v: unknown) => v === "1" || v === "true";
  const anyFlagPresent = ["x", "redditInbound", "redditProspecting", "partnerships"].some((k) => k in query);
  return {
    x: !anyFlagPresent || isTrue(query.x),
    redditInbound: !anyFlagPresent || isTrue(query.redditInbound),
    redditProspecting: !anyFlagPresent || isTrue(query.redditProspecting),
    // Piggybacks on the same once/day 09:00 Phoenix slot as Reddit
    // prospecting -- discovery.ts's own SCHEDULED_CADENCE_DAYS=7 gate
    // means most of these daily calls are a cheap no-op anyway (see
    // discovery.ts's doc comment), so no separate schedule slot is
    // needed and none of Vercel's 2 cron slots are spent on this.
    partnerships: !anyFlagPresent || isTrue(query.partnerships),
  };
}

/**
 * The higher-than-1x/day companion to daily-pipeline.ts, covering both X's
 * and Reddit's more-frequent workflows. Deliberately ONE file/serverless
 * function (not two, not four) -- this project was found to already be
 * sitting exactly AT Vercel Hobby's 12-function cap with the existing 12
 * files (one slot freed by folding the former api/cost-summary.ts into
 * api/summary.ts?view=cost -- see that file's doc comment). Adding a
 * separate function per workflow would have silently re-broken the cap
 * the same way docs/PROGRESS_LEDGER.md's Phase 15 already documents once
 * (a build that succeeds but then fails at "Deploying outputs..." with no
 * further log line).
 *
 * Which step-groups run is controlled by explicit query-string flags
 * (`?x=1`, `?redditInbound=1`, `?redditProspecting=1`) set by the CALLER
 * (.github/workflows/growth-pulse.yml), not inferred from wall-clock time
 * inside this handler. That's a deliberate choice over
 * "guess which schedule window `now` is nearest to": the four workflows
 * have three DIFFERENT cadences packed into one shared endpoint (X
 * prospecting+inbound 3x/day, Reddit inbound 3x/day, Reddit prospecting
 * 1x/day) and GitHub Actions cron triggers are already explicit UTC times
 * -- the workflow file is the one place that already has to know exactly
 * which invocation is which, so passing that as an explicit flag avoids a
 * second, fuzzier inference of the same fact (and the DST/off-by-an-hour
 * edge cases that inference would otherwise need re-solving here). If NO
 * flag is present at all, every step group runs -- this is the manual
 * "run now" behavior (e.g. calling this endpoint by hand while
 * debugging), matching how daily-pipeline.ts's own steps always all run.
 *
 * Every step is independently try/caught, same pattern as
 * daily-pipeline.ts: one source failing (an expired token, a rate limit,
 * missing Reddit credentials) never blocks the others.
 *
 * Called 3-4x/day by .github/workflows/growth-pulse.yml. Same auth
 * contract as daily-pipeline.ts: GET or POST with `Authorization: Bearer
 * <CRON_SECRET>`.
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
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const {
    x: runX,
    redditInbound: runRedditInbound,
    redditProspecting: runRedditProspecting,
    partnerships: runPartnerships,
  } = resolveStepGroups(req.query as Record<string, unknown>);

  const client = getServiceClient();
  const now = new Date();
  const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));
  const cursorStore = new SupabaseIngestionCursorStore(client);
  const results: StepResult[] = [];

  if (runX) {
    results.push(
      await runStep("x_mentions", async () => {
        const adapter = createXSignalAdapter(client);
        const userId = await adapter.resolveOwnUserId();
        const signals = await ingestXMentions(adapter, signalGraph, cursorStore, userId);
        return `${signals.length} ingested`;
      }),
    );
    results.push(
      await runStep("x_inbound", async () => {
        await recordSyncAttempt(client, "x_inbound");
        try {
          const adapter = createXSignalAdapter(client);
          const userId = await adapter.resolveOwnUserId();
          const repo = new SupabaseInboundRepository(client);
          const prospectingRepo = new SupabaseProspectingRepository(client);
          const result = await ingestInboundMentions(
            {
              adapter,
              repo,
              findCreatorIdByHandle: (handle) => findCreatorIdByHandle(client, handle),
              hasProspectingOutreach: (authorExternalId) => prospectingRepo.hasPriorOutreach("x", authorExternalId),
            },
            cursorStore,
            userId,
          );
          await recordSyncSuccess(client, "x_inbound", `${result.inserted} new, ${result.skippedExisting} already tracked`);
          return `${result.inserted} new inbound (${result.fetched} fetched, ${result.skippedExisting} already tracked)`;
        } catch (err) {
          await recordSyncFailure(client, "x_inbound", errorMessage(err));
          throw err;
        }
      }),
    );
    results.push(
      await runStep("x_prospecting", async () => {
        await recordSyncAttempt(client, "prospecting");
        try {
          const adapter = createXSignalAdapter(client);
          const repo = new SupabaseProspectingRepository(client);
          const result = await runProspectingSearch({
            adapter,
            repo,
            client,
            getMonthSpendUsd: () => getProspectingMonthSpendUsd(client),
            now,
          });
          if (result.skipped) {
            // A deliberate skip (budget/queue-capacity gate) is not a
            // failure -- still counts as a successful sync attempt so
            // Health doesn't flag it as broken.
            await recordSyncSuccess(client, "prospecting", `skipped -- ${result.skipReason}`);
            return `skipped -- ${result.skipReason}`;
          }
          await recordSyncSuccess(client, "prospecting", `${result.newCandidates} new, ${result.postsRead} read`);
          return `${result.newCandidates} new (${result.postsRead} read, ${result.excludedAsSpam} excluded as spam, $${result.costUsd.toFixed(4)}) across topics: ${result.topicsSearched.join(", ")}`;
        } catch (err) {
          await recordSyncFailure(client, "prospecting", errorMessage(err));
          throw err;
        }
      }),
    );
  }

  if (runRedditInbound) {
    results.push(
      await runStep("reddit_inbound", async () => {
        await recordSyncAttempt(client, "reddit_inbound");
        try {
          const adapter = createRedditSignalAdapter(client);
          const repo = new SupabaseInboundRepository(client);
          const prospectingRepo = new SupabaseProspectingRepository(client);
          const result = await ingestRedditInboundMentions(
            {
              adapter,
              repo,
              findCreatorIdByHandle: (handle) => findCreatorIdByHandle(client, handle),
              hasProspectingOutreach: (handle) => prospectingRepo.hasPriorOutreach("reddit", handle),
            },
            cursorStore,
            now,
          );
          await recordSyncSuccess(
            client,
            "reddit_inbound",
            `${result.inserted} new, ${result.skippedExisting} already tracked, ${result.notActionable} not actionable`,
          );
          return `${result.inserted} new inbound (${result.fetched} fetched, ${result.skippedExisting} already tracked, ${result.notActionable} not actionable)`;
        } catch (err) {
          await recordSyncFailure(client, "reddit_inbound", errorMessage(err));
          throw err;
        }
      }),
    );
  }

  if (runRedditProspecting) {
    results.push(
      await runStep("reddit_prospecting", async () => {
        await recordSyncAttempt(client, "reddit_prospecting");
        try {
          const adapter = createRedditSignalAdapter(client);
          const repo = new SupabaseProspectingRepository(client);
          const result = await runRedditProspectingSearch({ adapter, repo, client, now });
          if (result.skipped) {
            await recordSyncSuccess(client, "reddit_prospecting", `skipped -- ${result.skipReason}`);
            return `skipped -- ${result.skipReason}`;
          }
          await recordSyncSuccess(client, "reddit_prospecting", `${result.newCandidates} new, ${result.postsRead} read`);
          return `${result.newCandidates} new (${result.postsRead} read, ${result.excludedAsSpam} excluded as spam) across topics: ${result.topicsSearched.join(", ")}`;
        } catch (err) {
          await recordSyncFailure(client, "reddit_prospecting", errorMessage(err));
          throw err;
        }
      }),
    );
  }

  if (runPartnerships) {
    results.push(
      await runStep("partnerships_discovery", async () => {
        let adapter = null;
        try {
          adapter = createXSignalAdapter(client);
        } catch {
          // X credentials not configured -- discovery still runs against
          // existing-records sources (creators/prospecting/inbound) only.
        }
        const result = await runPartnershipDiscoveryStep({ client, adapter, triggeredBy: "scheduled", now });
        return `${result.status}: ${result.newCandidates} new (sources: ${result.sourcesSearched.join(", ") || "none"}, $${result.costUsd.toFixed(4)})${result.skipReason ? ` -- ${result.skipReason}` : ""}`;
      }),
    );
  }

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({
    results,
    ranGroups: { x: runX, redditInbound: runRedditInbound, redditProspecting: runRedditProspecting, partnerships: runPartnerships },
  });
}
