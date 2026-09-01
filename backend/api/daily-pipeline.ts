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
  ];

  const allOk = results.every((r) => r.ok);
  res.status(allOk ? 200 : 207).json({ results });
}
