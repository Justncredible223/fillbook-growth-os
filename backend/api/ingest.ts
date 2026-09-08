import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createXSignalAdapter } from "../src/signals/adapters/xAdapter.js";
import { createSearchConsoleAdapter } from "../src/signals/adapters/searchConsoleAdapter.js";
import { SupabaseIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore.js";
import { ingestXMentions } from "../src/signals/adapters/xIngestion.js";
import { ingestSearchConsoleQueries } from "../src/signals/adapters/searchConsoleIngestion.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The signal sources this endpoint can still trigger by hand. Exported so the contract is testable. */
export const MANUAL_INGEST_SOURCES = ["x", "search_console"] as const;
export type ManualIngestSource = (typeof MANUAL_INGEST_SOURCES)[number];

export function isManualIngestSource(value: unknown): value is ManualIngestSource {
  return typeof value === "string" && (MANUAL_INGEST_SOURCES as readonly string[]).includes(value);
}

/**
 * Manual single-source ingestion trigger -- POST /api/ingest?source=x |
 * search_console. Consolidated from separate endpoint files
 * (ingest-x-mentions.ts, ingest-search-console.ts) into one, because
 * Vercel's Hobby plan caps serverless functions per deployment at 12 and
 * this project hit it. The scheduled jobs (api/daily-pipeline.ts for
 * Search Console, api/growth-pulse.ts for X) run these automatically;
 * this endpoint stays for triggering just one source by hand (debugging,
 * or re-running after fixing an issue with one adapter without waiting
 * for the others).
 *
 * YouTube and TikTok are gone from here for good, not just from the
 * schedule: the owner distributes video through Fliki, neither source
 * ever produced a signal the owner acted on, and keeping their adapters
 * reachable only from this manual path meant two integrations that
 * could never be verified but still showed up as "degraded" on the
 * health screen. Their adapter/ingestion modules and tests were removed
 * with this change; the `youtube_video`/`tiktok_video` signal source
 * values remain valid for the historical rows already in the database.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const source = req.query.source;
  if (!isManualIngestSource(source)) {
    res.status(400).json({ error: `Query param 'source' must be one of: ${MANUAL_INGEST_SOURCES.join(", ")}` });
    return;
  }

  try {
    const client = getServiceClient();
    const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));

    if (source === "x") {
      const adapter = createXSignalAdapter(client);
      const cursorStore = new SupabaseIngestionCursorStore(client);
      const userId = await adapter.resolveOwnUserId();
      const signals = await ingestXMentions(adapter, signalGraph, cursorStore, userId);
      res.status(200).json({ ingested: signals.length });
      return;
    }

    // source === "search_console"
    const adapter = createSearchConsoleAdapter(client);
    const siteUrl = await adapter.resolveSiteUrl();
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - 3);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
    const signals = await ingestSearchConsoleQueries(adapter, signalGraph, siteUrl, isoDate(startDate), isoDate(endDate), now);
    res.status(200).json({ ingested: signals.length, siteUrl });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
