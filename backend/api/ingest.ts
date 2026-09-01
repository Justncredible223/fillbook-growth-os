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

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Manual single-source ingestion trigger -- POST /api/ingest?source=x |
 * youtube | search_console. Consolidated from three separate endpoint
 * files (ingest-x-mentions.ts, ingest-youtube.ts,
 * ingest-search-console.ts) into one, because Vercel's Hobby plan caps
 * serverless functions per deployment at 12 and this project hit it. The
 * scheduled daily job (api/daily-pipeline.ts) runs all three
 * automatically; this endpoint stays for triggering just one source by
 * hand (debugging, or re-running after fixing an issue with one adapter
 * without waiting for the others).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const source = req.query.source;
  if (source !== "x" && source !== "youtube" && source !== "search_console") {
    res.status(400).json({ error: "Query param 'source' must be one of: x, youtube, search_console" });
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

    if (source === "youtube") {
      const adapter = createYouTubeAdapter(client);
      const cursorStore = new SupabaseIngestionCursorStore(client);
      const signals = await ingestYouTubeVideos(adapter, signalGraph, cursorStore);
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
