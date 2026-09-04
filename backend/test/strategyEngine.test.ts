import { describe, it, expect } from "vitest";
import { generateStrategy } from "../src/strategy/strategyEngine";
import type { StrategyEngineInput, TopicStats, FormatStats } from "../src/strategy/types";

const now = new Date("2026-09-03T00:00:00Z");

function topic(overrides: Partial<TopicStats>): TopicStats {
  return {
    topic: "default topic",
    opportunityId: "opp-1",
    campaignCount: 5,
    reachedReadyForOwnerCount: 3,
    totalContentScorePasses: 8,
    totalContentScoreFails: 2,
    latestOpportunityScore: 70,
    ...overrides,
  };
}

function baseInput(overrides: Partial<StrategyEngineInput> = {}): StrategyEngineInput {
  return {
    topicStats: [],
    formatStats: [],
    seoCandidates: [],
    creatorCandidates: [],
    now,
    ...overrides,
  };
}

describe("generateStrategy", () => {
  it("recommends increasing a high-pass-rate topic with enough samples", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [topic({ topic: "trailing drawdown", totalContentScorePasses: 9, totalContentScoreFails: 1 })],
      }),
    );
    expect(result.topicsToIncrease).toHaveLength(1);
    expect(result.topicsToIncrease[0]!.topic).toBe("trailing drawdown");
    expect(result.topicsToDecrease).toHaveLength(0);
  });

  it("recommends decreasing a low-pass-rate topic", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [topic({ topic: "generic motivation", totalContentScorePasses: 1, totalContentScoreFails: 9 })],
      }),
    );
    expect(result.topicsToDecrease).toHaveLength(1);
    expect(result.topicsToDecrease[0]!.topic).toBe("generic motivation");
  });

  it("recommends retiring a topic that never reached ready-for-owner", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [
          topic({
            topic: "dead angle",
            reachedReadyForOwnerCount: 0,
            totalContentScorePasses: 0,
            totalContentScoreFails: 5,
          }),
        ],
      }),
    );
    expect(result.contentToRetire).toHaveLength(1);
    expect(result.contentToRetire[0]!.topic).toBe("dead angle");
  });

  it("ignores topics below the minimum sample size in either direction", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [topic({ topic: "too new", campaignCount: 1, totalContentScorePasses: 1, totalContentScoreFails: 0 })],
      }),
    );
    expect(result.topicsToIncrease).toHaveLength(0);
    expect(result.topicsToDecrease).toHaveLength(0);
  });

  it("marks lowConfidence true when fewer than 2 topics have enough data", () => {
    const result = generateStrategy(baseInput({ topicStats: [topic({})] }));
    expect(result.lowConfidence).toBe(true);
    expect(result.summary).toContain("Not enough completed campaigns");
  });

  it("marks lowConfidence false once at least 2 topics are scored", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [
          topic({ topic: "a", totalContentScorePasses: 8, totalContentScoreFails: 2 }),
          topic({ topic: "b", totalContentScorePasses: 1, totalContentScoreFails: 9 }),
        ],
      }),
    );
    expect(result.lowConfidence).toBe(false);
  });

  it("recommends testing a high-performing format with enough volume", () => {
    const format: FormatStats = {
      platform: "x",
      assetType: "post",
      assetCount: 5,
      reachedReadyForOwnerCount: 4,
      totalContentScorePasses: 9,
      totalContentScoreFails: 1,
    };
    const result = generateStrategy(baseInput({ formatStats: [format] }));
    expect(result.formatsToTest).toHaveLength(1);
    expect(result.formatsToTest[0]!.platform).toBe("x");
  });

  it("surfaces SEO candidates with velocity and no existing opportunity, excludes ones already covered", () => {
    const result = generateStrategy(
      baseInput({
        seoCandidates: [
          { topic: "rising query", velocity: 4, hasExistingOpportunity: false },
          { topic: "already covered", velocity: 4, hasExistingOpportunity: true },
          { topic: "no movement", velocity: 0, hasExistingOpportunity: false },
        ],
      }),
    );
    expect(result.seoOpportunities).toHaveLength(1);
    expect(result.seoOpportunities[0]!.topic).toBe("rising query");
  });

  it("surfaces creators with no interaction or a stale one, excludes recently-active creators", () => {
    const result = generateStrategy(
      baseInput({
        creatorCandidates: [
          { id: "c1", handle: "@neverContacted", category: "research_next", readinessScore: null, daysSinceLastInteraction: null },
          { id: "c2", handle: "@stale", category: "tier_b", readinessScore: 2, daysSinceLastInteraction: 45 },
          { id: "c3", handle: "@active", category: "tier_b", readinessScore: 3, daysSinceLastInteraction: 2 },
        ],
      }),
    );
    const handles = result.creatorOpportunities.map((c) => c.handle);
    expect(handles).toContain("@neverContacted");
    expect(handles).toContain("@stale");
    expect(handles).not.toContain("@active");
  });

  it("suggests an experiment when a topic to increase exists", () => {
    const result = generateStrategy(
      baseInput({
        topicStats: [topic({ topic: "winning angle", totalContentScorePasses: 9, totalContentScoreFails: 1 })],
      }),
    );
    expect(result.experimentsToRun.length).toBeGreaterThan(0);
    expect(result.experimentsToRun[0]!.hypothesis).toContain("winning angle");
  });

  it("produces an empty, non-crashing report for a system with zero data", () => {
    const result = generateStrategy(baseInput());
    expect(result.topicsToIncrease).toEqual([]);
    expect(result.topicsToDecrease).toEqual([]);
    expect(result.lowConfidence).toBe(true);
    expect(result.summary).not.toBe("");
  });
});
