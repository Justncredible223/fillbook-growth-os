import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createXSignalAdapter } from "../src/signals/adapters/xAdapter.js";
import { SupabaseIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore.js";
import { ingestXMentions } from "../src/signals/adapters/xIngestion.js";

/**
 * Triggers one round of X mention ingestion. POST-only since it has real
 * side effects: it spends X API credits (Owned Reads, ~$0.001/mention)
 * and writes signal rows. Manually triggerable for now; wiring this to
 * Vercel Cron is a small follow-up once it's been run and verified at
 * least once against the real API.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const adapter = createXSignalAdapter(client);
    const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));
    const cursorStore = new SupabaseIngestionCursorStore(client);

    const userId = await adapter.resolveOwnUserId();
    const signals = await ingestXMentions(adapter, signalGraph, cursorStore, userId);

    res.status(200).json({ ingested: signals.length });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
