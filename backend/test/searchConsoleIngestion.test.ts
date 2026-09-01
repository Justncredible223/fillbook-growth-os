import { describe, it, expect } from "vitest";
import { ingestSearchConsoleQueries } from "../src/signals/adapters/searchConsoleIngestion";
import { SignalGraph } from "../src/signals/signalGraph";
import { InMemorySignalRepository } from "../src/signals/inMemorySignalRepository";
import type { SearchConsoleQueryRow } from "../src/signals/adapters/searchConsoleAdapter";

class FakeSearchConsoleAdapter {
  constructor(private rows: SearchConsoleQueryRow[]) {}

  async fetchTopQueries(_siteUrl: string, _startDate: string, _endDate: string): Promise<SearchConsoleQueryRow[]> {
    return this.rows;
  }
}

describe("ingestSearchConsoleQueries", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ingests each query row as a signal with the query as topic", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const adapter = new FakeSearchConsoleAdapter([
      { query: "futures position sizing", clicks: 12, impressions: 300, ctr: 0.04, position: 8.5 },
    ]);

    const signals = await ingestSearchConsoleQueries(
      adapter as any,
      graph,
      "https://fillbookhq.com/",
      "2026-08-01",
      "2026-08-07",
      now,
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]!.source).toBe("search_console_query");
    expect(signals[0]!.topic).toBe("futures position sizing");
    expect(signals[0]!.observedAt).toEqual(now);
    expect(signals[0]!.privacyClassification).toBe("aggregated");
    expect(signals[0]!.evidence).toMatchObject({ query: "futures position sizing", clicks: 12 });
  });

  it("returns an empty array when there are no query rows", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const adapter = new FakeSearchConsoleAdapter([]);

    const signals = await ingestSearchConsoleQueries(
      adapter as any,
      graph,
      "https://fillbookhq.com/",
      "2026-08-01",
      "2026-08-07",
      now,
    );

    expect(signals).toEqual([]);
  });
});
