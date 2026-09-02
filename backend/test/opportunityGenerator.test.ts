import { describe, it, expect } from "vitest";
import { OpportunityEngine } from "../src/opportunities/opportunityEngine";
import { InMemoryOpportunityRepository } from "../src/opportunities/inMemoryOpportunityRepository";
import { generateOpportunitiesFromSignals, estimateRelevance } from "../src/opportunities/opportunityGenerator";
import type { Signal } from "../src/signals/types";

function makeSignal(overrides: Partial<Signal>): Signal {
  return {
    id: "signal-1",
    source: "x_mention",
    topic: null,
    evidence: { text: "generic text" },
    observedAt: new Date("2026-09-01T00:00:00Z"),
    confidence: 0.6,
    velocity: null,
    fillbookRelevance: null,
    audienceRelevance: null,
    privacyClassification: "public",
    sourceReference: null,
    clusterId: null,
    ...overrides,
  };
}

describe("estimateRelevance", () => {
  it("scores higher with more matched keywords", () => {
    const low = estimateRelevance("just saying hi");
    const high = estimateRelevance("revenge trading breached my funded prop firm account, need better journal discipline");
    expect(high.fillbookRelevance).toBeGreaterThan(low.fillbookRelevance);
    expect(high.fillbookRelevance).toBeLessThanOrEqual(1);
  });
});

describe("generateOpportunitiesFromSignals", () => {
  it("creates one opportunity per un-topic'd signal", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const signals = [
      makeSignal({ id: "s1", source: "x_mention", evidence: { text: "I keep breaching my funded account from revenge trading" } }),
      makeSignal({ id: "s2", source: "youtube_video", topic: null, evidence: { title: "Prop firm drawdown rules explained" } }),
    ];

    const result = await generateOpportunitiesFromSignals(engine, signals, new Set());

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    const open = await repo.listOpen();
    expect(open).toHaveLength(2);
    expect(open.every((o) => o.signalIds.length === 1)).toBe(true);
  });

  it("groups topic'd signals (search_console_query) into one opportunity per topic", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const signals = [
      makeSignal({ id: "s1", source: "search_console_query", topic: "prop firm journal", evidence: { query: "prop firm journal" } }),
      makeSignal({ id: "s2", source: "search_console_query", topic: "prop firm journal", evidence: { query: "prop firm journal" } }),
      makeSignal({ id: "s3", source: "search_console_query", topic: "unrelated query", evidence: { query: "unrelated query" } }),
    ];

    const result = await generateOpportunitiesFromSignals(engine, signals, new Set());

    expect(result.created).toBe(2); // 2 topics -> 2 opportunities, not 3
    const open = await repo.listOpen();
    const grouped = open.find((o) => o.signalIds.length === 2);
    expect(grouped).toBeDefined();
  });

  it("skips signals already covered by an existing opportunity", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const signals = [makeSignal({ id: "s1" }), makeSignal({ id: "s2" })];

    const result = await generateOpportunitiesFromSignals(engine, signals, new Set(["s1"]));

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("recommends the tiktok platform for tiktok_video signals", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const signals = [
      makeSignal({ id: "s1", source: "tiktok_video", evidence: { title: "Why 2 contracts is a bad rule" } }),
    ];

    await generateOpportunitiesFromSignals(engine, signals, new Set());

    const open = await repo.listOpen();
    expect(open[0]!.recommendedChannels).toEqual(["tiktok"]);
  });

  it("is idempotent -- re-running with the same already-covered set creates nothing new", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const signals = [makeSignal({ id: "s1" })];

    const first = await generateOpportunitiesFromSignals(engine, signals, new Set());
    expect(first.created).toBe(1);

    const covered = new Set((await repo.listOpen()).flatMap((o) => o.signalIds));
    const second = await generateOpportunitiesFromSignals(engine, signals, covered);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
