import { describe, it, expect } from "vitest";
import { InMemoryOpportunityRepository } from "../src/opportunities/inMemoryOpportunityRepository";

describe("InMemoryOpportunityRepository.listOpen", () => {
  it("returns only open opportunities, sorted by score descending", async () => {
    const repo = new InMemoryOpportunityRepository();
    await repo.insert({
      title: "Low score",
      score: 20,
      urgency: "low",
      confidence: 0.5,
      rationale: "r",
      recommendedChannels: [],
      recommendedCampaignType: null,
      approvalClass: "EXTERNAL_DRAFT",
      signalIds: [],
    });
    const high = await repo.insert({
      title: "High score",
      score: 80,
      urgency: "high",
      confidence: 0.9,
      rationale: "r",
      recommendedChannels: [],
      recommendedCampaignType: null,
      approvalClass: "EXTERNAL_DRAFT",
      signalIds: [],
    });

    const open = await repo.listOpen();
    expect(open).toHaveLength(2);
    expect(open[0]!.id).toBe(high.id);
  });
});
