export type BrandRuleType =
  | "positioning"
  | "voice"
  | "vocabulary_preferred"
  | "vocabulary_prohibited"
  | "claim_allowed"
  | "claim_prohibited"
  | "cta_philosophy"
  | "competitor_rule"
  | "disclosure_rule"
  | "financial_claim_restriction";

export interface BrandRule {
  id: string;
  version: number;
  ruleType: BrandRuleType;
  content: string;
  sourceDoc: string | null;
  isActive: boolean;
}

export type TrustLevel = "verified" | "needs_review" | "deprecated";

export interface KnowledgeDocument {
  id: string;
  topic: string;
  title: string;
  content: string;
  sourceDoc: string | null;
  trustLevel: TrustLevel;
}

export interface BrandConstitutionRepository {
  getActiveRules(): Promise<BrandRule[]>;
}

export interface KnowledgeBrainRepository {
  getByTopic(topic: string): Promise<KnowledgeDocument[]>;
}
