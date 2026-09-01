import type { SignalGraph } from "../signalGraph.js";
import type { Signal } from "../types.js";
import type { SearchConsoleAdapter } from "./searchConsoleAdapter.js";

/**
 * Ingests current top-query performance as signals. Unlike X mentions,
 * this is a periodic snapshot (aggregate stats over a date window), not a
 * stream of discrete new events -- there's no natural "new item" cursor,
 * so this intentionally re-ingests the current top queries every run.
 * SignalGraph's own 72h topic clustering (topic = query text) is what
 * turns repeated appearances of the same query into rising velocity,
 * rather than a cursor here trying to dedupe them.
 */
export async function ingestSearchConsoleQueries(
  adapter: SearchConsoleAdapter,
  signalGraph: SignalGraph,
  siteUrl: string,
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): Promise<Signal[]> {
  const rows = await adapter.fetchTopQueries(siteUrl, startDate, endDate, 25, now);
  const signals: Signal[] = [];

  for (const row of rows) {
    const signal = await signalGraph.ingest(
      {
        source: "search_console_query",
        topic: row.query,
        evidence: {
          query: row.query,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          dateRange: { startDate, endDate },
        },
        observedAt: now,
        sourceReference: null,
        privacyClassification: "aggregated",
      },
      now,
    );
    signals.push(signal);
  }

  return signals;
}
