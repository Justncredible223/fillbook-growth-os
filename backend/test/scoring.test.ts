import { describe, it, expect } from "vitest";
import { scoreOpportunity } from "../src/opportunities/scoring";
import type { ScoringInput } from "../src/opportunities/types";

const base: ScoringInput = {
  title: "Prop firm trailing drawdown confusion",
  audienceRelevance: 0.8,
  fillbookRelevance: 0.9,
  velocity: 3,
  confidence: 0.8,
  daysSinceLastCoveredSameTopic: null,
  duplicateOpenCount: 0,
  signalIds: ["s1"],
  recommendedChannels: ["x", "youtube"],
};

describe("scoreOpportunity", () => {
  it("scores strong, fresh, high-relevance evidence highly", () => {
    const result = scoreOpportunity(base);
    expect(result.score).toBeGreaterThan(70);
    expect(result.rationale).toContain("audience relevance");
  });

  it("marks high urgency when velocity is high even if score is only moderate", () => {
    const result = scoreOpportunity({ ...base, velocity: 8, audienceRelevance: 0.3, fillbookRelevance: 0.3 });
    expect(result.urgency).toBe("high");
  });

  it("applies a weak-evidence penalty below 0.4 confidence", () => {
    const strong = scoreOpportunity(base);
    const weak = scoreOpportunity({ ...base, confidence: 0.2 });
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.rationale).toContain("weak evidence penalty");
  });

  it("penalizes topic fatigue when the topic was covered very recently", () => {
    const fresh = scoreOpportunity(base);
    const fatigued = scoreOpportunity({ ...base, daysSinceLastCoveredSameTopic: 1 });
    expect(fatigued.score).toBeLessThan(fresh.score);
    expect(fatigued.rationale).toContain("topic fatigue");
  });

  it("does not penalize topic fatigue once outside the fatigue window", () => {
    const outsideWindow = scoreOpportunity({ ...base, daysSinceLastCoveredSameTopic: 30 });
    expect(outsideWindow.rationale).not.toContain("topic fatigue");
  });

  it("penalizes duplicate open opportunities, capped at a maximum", () => {
    const oneDupe = scoreOpportunity({ ...base, duplicateOpenCount: 1 });
    const manyDupes = scoreOpportunity({ ...base, duplicateOpenCount: 10 });
    expect(oneDupe.score).toBeGreaterThan(manyDupes.score);
    expect(manyDupes.rationale).toContain("10 duplicate open opportunities");
  });

  it("never returns a negative score or a score above 100", () => {
    const terrible = scoreOpportunity({
      ...base,
      audienceRelevance: 0,
      fillbookRelevance: 0,
      confidence: 0,
      velocity: 0,
      daysSinceLastCoveredSameTopic: 0,
      duplicateOpenCount: 20,
    });
    expect(terrible.score).toBeGreaterThanOrEqual(0);

    const perfect = scoreOpportunity({
      ...base,
      audienceRelevance: 1,
      fillbookRelevance: 1,
      confidence: 1,
      velocity: 100,
    });
    expect(perfect.score).toBeLessThanOrEqual(100);
  });

  it("marks low urgency for weak, low-scoring opportunities", () => {
    const result = scoreOpportunity({
      ...base,
      audienceRelevance: 0.1,
      fillbookRelevance: 0.1,
      confidence: 0.1,
      velocity: 0,
    });
    expect(result.urgency).toBe("low");
  });
});
