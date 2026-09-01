import { describe, it, expect } from "vitest";
import { SignalGraph } from "../src/signals/signalGraph";
import { InMemorySignalRepository } from "../src/signals/inMemorySignalRepository";

describe("SignalGraph", () => {
  const now = new Date("2026-08-31T12:00:00Z");

  it("ingests a signal and assigns it a fresh cluster if no recent same-topic signal exists", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const s = await graph.ingest(
      { source: "search_console", topic: "prop_firm_drawdown_rules", evidence: { query: "prop firm drawdown" }, observedAt: now },
      now,
    );
    expect(s.clusterId).toBeTruthy();
    expect(s.velocity).toBe(0); // no prior signals on this topic yet
  });

  it("clusters a new signal with a recent same-topic signal instead of starting a new cluster", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const first = await graph.ingest(
      { source: "search_console", topic: "trailing_drawdown", evidence: {}, observedAt: new Date(now.getTime() - 60 * 60_000) },
      now,
    );
    const second = await graph.ingest(
      { source: "youtube_analytics", topic: "trailing_drawdown", evidence: {}, observedAt: now },
      now,
    );
    expect(second.clusterId).toBe(first.clusterId);
  });

  it("does not cluster signals on unrelated topics together", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const a = await graph.ingest({ source: "search_console", topic: "topic_a", evidence: {}, observedAt: now }, now);
    const b = await graph.ingest({ source: "search_console", topic: "topic_b", evidence: {}, observedAt: now }, now);
    expect(a.clusterId).not.toBe(b.clusterId);
  });

  it("does not cluster a same-topic signal outside the clustering window", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const old = await graph.ingest(
      { source: "search_console", topic: "stale_topic", evidence: {}, observedAt: new Date(now.getTime() - 100 * 60 * 60_000) },
      new Date(now.getTime() - 100 * 60 * 60_000),
    );
    const fresh = await graph.ingest({ source: "search_console", topic: "stale_topic", evidence: {}, observedAt: now }, now);
    expect(fresh.clusterId).not.toBe(old.clusterId);
  });

  it("computes velocity as the count of same-topic signals in the last 24h", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    await graph.ingest({ source: "x", topic: "hot_topic", evidence: {}, observedAt: new Date(now.getTime() - 2 * 60 * 60_000) }, now);
    await graph.ingest({ source: "x", topic: "hot_topic", evidence: {}, observedAt: new Date(now.getTime() - 1 * 60 * 60_000) }, now);
    const third = await graph.ingest({ source: "x", topic: "hot_topic", evidence: {}, observedAt: now }, now);
    expect(third.velocity).toBe(2); // 2 prior signals found before this one was inserted
  });

  it("defaults confidence to 0.5 and privacy classification to public when not provided", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const s = await graph.ingest({ source: "public_web", topic: null, evidence: {}, observedAt: now }, now);
    expect(s.confidence).toBe(0.5);
    expect(s.privacyClassification).toBe("public");
  });
});
