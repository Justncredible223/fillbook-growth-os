import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createXSignalAdapter } from "../src/signals/adapters/xAdapter.js";
import { createYouTubeAdapter } from "../src/signals/adapters/youtubeAdapter.js";
import { createSearchConsoleAdapter } from "../src/signals/adapters/searchConsoleAdapter.js";
import { SupabaseIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore.js";
import { ingestXMentions } from "../src/signals/adapters/xIngestion.js";
import { ingestYouTubeVideos } from "../src/signals/adapters/youtubeIngestion.js";
import { ingestSearchConsoleQueries } from "../src/signals/adapters/searchConsoleIngestion.js";
import { runGenerateOpportunities } from "../src/opportunities/runGenerateOpportunities.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { SupabaseAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository.js";
import { runAutoDraftStep } from "../src/opportunities/autoDraftStep.js";
import { buildSupabaseRunCampaignDeps } from "../src/content/runCampaignForOpportunity.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

/**
 * The single scheduled entry point for this project's whole ingestion ->
 * opportunity pipeline. Deliberately ONE endpoint doing four things
 * rather than four separate cron jobs, because Vercel's Hobby plan caps
 * cron jobs at 2 total and once-per-day
 * (https://vercel.com/docs/cron-jobs/usage-and-pricing). Each step runs
 * independently and records its own ok/error -- one source failing (e.g.
 * a token needing re-auth) doesn't block the others or the opportunity
 * generation step, which runs over whatever signals landed regardless.
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
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const client = getServiceClient();
  const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));
  const cursorStore = new SupabaseIngestionCursorStore(client);

  const results: StepResult[] = [
    await runStep("x_mentions", async () => {
      const adapter = createXSignalAdapter(client);
      const userId = await adapter.resolveOwnUserId();
      const signals = await ingestXMentions(adapter, signalGraph, cursorStore, userId);
      return `${signals.length} ingested`;
    }),
    await runStep("youtube", async () => {
      const adapter = createYouTubeAdapter(client);
      const signals = await ingestYouTubeVideos(adapter, signalGraph, cursorStore);
      return `${signals.length} ingested`;
    }),
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
  ];

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({ results });
}
