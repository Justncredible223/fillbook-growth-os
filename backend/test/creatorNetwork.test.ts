import { describe, it, expect } from "vitest";
import { CreatorNetwork, CreatorNetworkError } from "../src/creators/creatorNetwork";
import { InMemoryCreatorRepository } from "../src/creators/inMemoryCreatorRepository";
import type { Creator } from "../src/creators/types";

function makeCreator(overrides: Partial<Creator> = {}): Creator {
  return {
    id: "creator-1",
    handle: "@example",
    displayName: null,
    platform: "x",
    category: "tier_b",
    readinessScore: 1,
    followerCount: null,
    creatorProductMoment: null,
    notes: null,
    rejectionReason: null,
    lastInteractionAt: null,
    sourceDoc: "test",
    ...overrides,
  };
}

const confirmedInteraction = {
  interactionType: "x_reply" as const,
  occurredAt: "2026-09-01T00:00:00Z",
  summary: "Replied to a real thread.",
  confirmed: true,
};

describe("CreatorNetwork.advanceReadiness", () => {
  it("advances exactly one step and logs the interaction", async () => {
    const creator = makeCreator({ readinessScore: 1 });
    const repo = new InMemoryCreatorRepository([creator]);
    const network = new CreatorNetwork(repo);

    const updated = await network.advanceReadiness(creator, confirmedInteraction);

    expect(updated.readinessScore).toBe(2);
    expect(updated.lastInteractionAt).toBe(confirmedInteraction.occurredAt);
    expect(repo.interactions).toHaveLength(1);
    expect(repo.interactions[0]!.confirmed).toBe(true);
  });

  it("refuses to advance on an unconfirmed interaction", async () => {
    const creator = makeCreator({ readinessScore: 1 });
    const repo = new InMemoryCreatorRepository([creator]);
    const network = new CreatorNetwork(repo);

    await expect(
      network.advanceReadiness(creator, { ...confirmedInteraction, confirmed: false }),
    ).rejects.toThrow(CreatorNetworkError);
    expect(repo.interactions).toHaveLength(0);
  });

  it("refuses to advance a rejected creator", async () => {
    const creator = makeCreator({ category: "rejected", readinessScore: null });
    const repo = new InMemoryCreatorRepository([creator]);
    const network = new CreatorNetwork(repo);

    await expect(network.advanceReadiness(creator, confirmedInteraction)).rejects.toThrow(
      "rejected -- readiness cannot advance",
    );
  });

  it("refuses to advance past the maximum readiness score", async () => {
    const creator = makeCreator({ readinessScore: 10 });
    const repo = new InMemoryCreatorRepository([creator]);
    const network = new CreatorNetwork(repo);

    await expect(network.advanceReadiness(creator, confirmedInteraction)).rejects.toThrow(
      "maximum readiness score",
    );
  });

  it("refuses to advance a creator with no readiness score at all", async () => {
    const creator = makeCreator({ readinessScore: null });
    const repo = new InMemoryCreatorRepository([creator]);
    const network = new CreatorNetwork(repo);

    await expect(network.advanceReadiness(creator, confirmedInteraction)).rejects.toThrow(
      "no readiness score to advance from",
    );
  });
});

describe("InMemoryCreatorRepository", () => {
  it("filters by category", async () => {
    const repo = new InMemoryCreatorRepository([
      makeCreator({ id: "a", category: "tier_b" }),
      makeCreator({ id: "b", category: "rejected", readinessScore: null }),
    ]);

    const rejected = await repo.listByCategory("rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.id).toBe("b");
  });
});
