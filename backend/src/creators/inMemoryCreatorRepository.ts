import type { Creator, CreatorInteraction, CreatorRepository, CreatorCategory, NewCreatorInteraction } from "./types.js";

let nextInteractionId = 1;

export class InMemoryCreatorRepository implements CreatorRepository {
  interactions: CreatorInteraction[] = [];

  constructor(private creators: Creator[]) {}

  async listAll(): Promise<Creator[]> {
    return [...this.creators];
  }

  async listByCategory(category: CreatorCategory): Promise<Creator[]> {
    return this.creators.filter((c) => c.category === category);
  }

  async updateReadiness(creatorId: string, readinessScore: number, lastInteractionAt: string): Promise<void> {
    const creator = this.creators.find((c) => c.id === creatorId);
    if (!creator) throw new Error(`creator ${creatorId} not found`);
    creator.readinessScore = readinessScore;
    creator.lastInteractionAt = lastInteractionAt;
  }

  async insertInteraction(creatorId: string, interaction: NewCreatorInteraction): Promise<CreatorInteraction> {
    const record: CreatorInteraction = {
      id: `interaction-${nextInteractionId++}`,
      creatorId,
      interactionType: interaction.interactionType,
      occurredAt: interaction.occurredAt,
      summary: interaction.summary,
      confirmed: interaction.confirmed,
      sourceDoc: interaction.sourceDoc ?? null,
    };
    this.interactions.push(record);
    return record;
  }
}
