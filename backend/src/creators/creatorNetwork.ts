import type { Creator, CreatorRepository, NewCreatorInteraction } from "./types.js";

export class CreatorNetworkError extends Error {}

/**
 * Enforces the real practice this replaces (fillbookhq/docs/social/
 * CREATOR_NETWORK.md): "Never skip stages; never advance without a
 * logged, evidence-based interaction." The invariant lives here, not in
 * SQL, because it's a business rule about *why* a score may change, not
 * a shape constraint a CHECK clause can express.
 */
export class CreatorNetwork {
  constructor(private repo: CreatorRepository) {}

  /**
   * Advances a creator exactly one readiness step, and only alongside a
   * confirmed interaction that justifies it. Throws rather than silently
   * clamping or skipping -- a caller trying to jump stages or log an
   * unconfirmed interaction as justification has a bug, not a case to
   * paper over.
   */
  async advanceReadiness(creator: Creator, interaction: NewCreatorInteraction): Promise<Creator> {
    if (creator.category === "rejected") {
      throw new CreatorNetworkError(`${creator.handle} is rejected -- readiness cannot advance`);
    }
    if (creator.readinessScore === null) {
      throw new CreatorNetworkError(`${creator.handle} has no readiness score to advance from`);
    }
    if (!interaction.confirmed) {
      throw new CreatorNetworkError(
        `Cannot advance ${creator.handle}'s readiness on an unconfirmed interaction -- confirm it was actually posted first`,
      );
    }
    const nextScore = creator.readinessScore + 1;
    if (nextScore > 10) {
      throw new CreatorNetworkError(`${creator.handle} is already at the maximum readiness score (10)`);
    }

    await this.repo.insertInteraction(creator.id, interaction);
    await this.repo.updateReadiness(creator.id, nextScore, interaction.occurredAt);

    return { ...creator, readinessScore: nextScore, lastInteractionAt: interaction.occurredAt };
  }
}
