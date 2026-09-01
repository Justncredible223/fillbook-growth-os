import { describe, it, expect } from "vitest";
import { OpportunityEngine } from "../src/opportunities/opportunityEngine";
import { InMemoryOpportunityRepository } from "../src/opportunities/inMemoryOpportunityRepository";

describe("OpportunityEngine", () => {
  it("creates an opportunity with EXTERNAL_DRAFT approval class, never EXTERNAL_WRITE", async () => {
    const repo = new InMemoryOpportunityRepository();
    const engine = new OpportunityEngine(repo);
    const opp = await engine.createFromEvidence({
      title: "Prop firm rule change",
      audienceRelevance: 0.7,
      fillbookRelevance: 0.8,
      velocity: 2,
      confidence: 0.7,
      daysSinceLastCoveredSameTopic: null,
      duplicateOpenCount: 0,
      signalIds: ["s1", "s2"],
      recommendedChannels: ["x"],
    });
    expect(opp.approvalClass).toBe("EXTERNAL_DRAFT");
    expect(opp.status).toBe("open");
    expect(opp.signalIds).toEqual(["s1", "s2"]);
    expect(opp.score).toBeGreaterThan(0);
  });
});
