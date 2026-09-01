import type { KnowledgeBrainRepository, KnowledgeDocument } from "./types.js";

/**
 * "Never let models invent Fillbook functionality. Every material product
 * claim must resolve to trusted knowledge." (master spec, Fillbook
 * Knowledge Brain). This class is the enforcement point: content that
 * wants to make a claim about a topic must go through
 * `requireVerifiedKnowledge(topic)` first and use ONLY what comes back —
 * it throws if nothing verified exists, rather than letting a caller
 * silently fall through to model imagination.
 */
export class UnsupportedClaimError extends Error {
  constructor(topic: string) {
    super(
      `KnowledgeBrain: no verified knowledge exists for topic "${topic}". ` +
        `Do not generate a factual claim about this topic — either add a verified ` +
        `knowledge_documents entry first, or write content that avoids the claim.`,
    );
    this.name = "UnsupportedClaimError";
  }
}

export class KnowledgeBrain {
  constructor(private repo: KnowledgeBrainRepository) {}

  /** Returns all documents for a topic, verified or not — for review/audit UIs. */
  async getAll(topic: string): Promise<KnowledgeDocument[]> {
    return this.repo.getByTopic(topic);
  }

  /**
   * Returns only verified documents for a topic. Throws
   * UnsupportedClaimError if there are none — this is the guard content
   * generation must call before asserting any material product fact.
   */
  async requireVerifiedKnowledge(topic: string): Promise<KnowledgeDocument[]> {
    const docs = (await this.repo.getByTopic(topic)).filter((d) => d.trustLevel === "verified");
    if (docs.length === 0) {
      throw new UnsupportedClaimError(topic);
    }
    return docs;
  }
}
