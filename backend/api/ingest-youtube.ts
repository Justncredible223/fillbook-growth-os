import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createYouTubeAdapter } from "../src/signals/adapters/youtubeAdapter.js";
import { SupabaseIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore.js";
import { ingestYouTubeVideos } from "../src/signals/adapters/youtubeIngestion.js";

/**
 * Triggers one round of YouTube video ingestion. POST-only -- writes
 * signal rows. Manually triggerable for now; see
 * docs/PROGRESS_LEDGER.md Phase 4.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const adapter = createYouTubeAdapter(client);
    const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));
    const cursorStore = new SupabaseIngestionCursorStore(client);

    const signals = await ingestYouTubeVideos(adapter, signalGraph, cursorStore);

    res.status(200).json({ ingested: signals.length });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
