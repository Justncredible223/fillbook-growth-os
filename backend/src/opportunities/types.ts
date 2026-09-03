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
  createdAt: Date;
  /**
   * The real X permalink, present only when this opportunity traces back
   * to exactly one signal whose source is 'x_mention' -- see
   * SupabaseOpportunityRepository.listOpen(). A multi-signal trend
   * cluster has no single canonical post, so it's deliberately left
   * undefined rather than picking one arbitrarily. Its presence is what
   * the Android app uses to treat this as an "engagement" opportunity
   * (reply-worthy) versus a "campaign/content" opportunity -- never
   * inferred from title text.
   */
  sourceUrl?: string;
  /**
   * The real @handle X resolved for the mention's author, present only
   * alongside sourceUrl and only when X's API actually returned one for
   * that signal (see xIngestion.ts / xAdapter.ts's user expansion).
   * Never a guess -- absent, not fabricated, when unavailable.
   */
  authorHandle?: string;
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
  insert(opportunity: Omit<Opportunity, "id" | "status" | "createdAt">): Promise<Opportunity>;
  listOpen(): Promise<Opportunity[]>;
}
