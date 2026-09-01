export type Urgency = "low" | "normal" | "high";
export type ApprovalClass = "READ" | "INTERNAL_WRITE" | "EXTERNAL_DRAFT" | "EXTERNAL_WRITE";
export type OpportunityStatus = "open" | "actioned" | "dismissed" | "expired";

export interface Opportunity {
  id: string;
  title: string;
  score: number;
  urgency: Urgency;
  confidence: number;
  rationale: string;
  recommendedChannels: string[];
  recommendedCampaignType: string | null;
  approvalClass: ApprovalClass;
  status: OpportunityStatus;
  signalIds: string[];
}

/** Inputs the scorer needs about a candidate opportunity's evidence. */
export interface ScoringInput {
  title: string;
  audienceRelevance: number; // 0-1
  fillbookRelevance: number; // 0-1
  velocity: number; // signals in the last 24h
  confidence: number; // 0-1, evidence strength
  /** Days since a very similar topic was last covered; null = never. */
  daysSinceLastCoveredSameTopic: number | null;
  /** How many other open opportunities currently cover this same topic. */
  duplicateOpenCount: number;
  signalIds: string[];
  recommendedChannels: string[];
  recommendedCampaignType?: string;
}

export interface OpportunityRepository {
  insert(opportunity: Omit<Opportunity, "id" | "status">): Promise<Opportunity>;
  listOpen(): Promise<Opportunity[]>;
}
