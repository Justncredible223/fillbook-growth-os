import type {
  BrandConstitutionRepository,
  BrandRule,
  KnowledgeBrainRepository,
  KnowledgeDocument,
} from "./types";

export class InMemoryBrandConstitutionRepository implements BrandConstitutionRepository {
  constructor(private rules: BrandRule[]) {}
  async getActiveRules(): Promise<BrandRule[]> {
    return this.rules;
  }
}

export class InMemoryKnowledgeBrainRepository implements KnowledgeBrainRepository {
  constructor(private docs: KnowledgeDocument[]) {}
  async getByTopic(topic: string): Promise<KnowledgeDocument[]> {
    return this.docs.filter((d) => d.topic === topic);
  }
}
