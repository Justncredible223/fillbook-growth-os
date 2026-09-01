import { describe, it, expect } from "vitest";
import { KnowledgeBrain, UnsupportedClaimError } from "../src/knowledge/knowledgeBrain";
import { InMemoryKnowledgeBrainRepository } from "../src/knowledge/inMemoryRepositories";
import type { KnowledgeDocument } from "../src/knowledge/types";

const pricingDoc: KnowledgeDocument = {
  id: "doc_1",
  topic: "pricing",
  title: "Fillbook pricing plans",
  content: "Free: 50 trades. Pro: $14.99/mo. Elite: $24.99/mo.",
  sourceDoc: "fillbookhq:README.md",
  trustLevel: "verified",
};

const unverifiedDoc: KnowledgeDocument = {
  id: "doc_2",
  topic: "roadmap",
  title: "Speculative roadmap note",
  content: "We might add options trading support someday.",
  sourceDoc: null,
  trustLevel: "needs_review",
};

describe("KnowledgeBrain", () => {
  it("returns verified knowledge for a topic that has it", async () => {
    const brain = new KnowledgeBrain(new InMemoryKnowledgeBrainRepository([pricingDoc]));
    const docs = await brain.requireVerifiedKnowledge("pricing");
    expect(docs).toHaveLength(1);
    expect(docs[0]!.content).toContain("$14.99");
  });

  it("throws UnsupportedClaimError for a topic with no knowledge at all", async () => {
    const brain = new KnowledgeBrain(new InMemoryKnowledgeBrainRepository([pricingDoc]));
    await expect(brain.requireVerifiedKnowledge("options_trading_support")).rejects.toThrow(
      UnsupportedClaimError,
    );
  });

  it("throws UnsupportedClaimError when the only knowledge for a topic is unverified — this is the anti-fabrication guarantee", async () => {
    const brain = new KnowledgeBrain(new InMemoryKnowledgeBrainRepository([unverifiedDoc]));
    await expect(brain.requireVerifiedKnowledge("roadmap")).rejects.toThrow(UnsupportedClaimError);
  });

  it("getAll returns unverified docs too, for review/audit UIs", async () => {
    const brain = new KnowledgeBrain(new InMemoryKnowledgeBrainRepository([unverifiedDoc]));
    const docs = await brain.getAll("roadmap");
    expect(docs).toHaveLength(1);
  });
});
