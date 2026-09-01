import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseSignalRepository } from "../src/signals/supabaseSignalRepository.js";
import { SignalGraph } from "../src/signals/signalGraph.js";
import { createSearchConsoleAdapter } from "../src/signals/adapters/searchConsoleAdapter.js";
import { ingestSearchConsoleQueries } from "../src/signals/adapters/searchConsoleIngestion.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Triggers one round of Search Console query ingestion. POST-only --
 * writes signal rows. Manually triggerable for now; see
 * docs/PROGRESS_LEDGER.md Phase 4.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const adapter = createSearchConsoleAdapter(client);
    const signalGraph = new SignalGraph(new SupabaseSignalRepository(client));

    const siteUrl = await adapter.resolveSiteUrl();

    // Search Console data has a real processing lag -- query the last 7
    // days up through 3 days ago rather than "today", which would come
    // back empty/incomplete.
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

    res.status(200).json({ ingested: signals.length, siteUrl });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
