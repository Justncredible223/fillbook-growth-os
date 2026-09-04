/**
 * Strategy Evolution -- see docs/PROGRESS_LEDGER.md and the master spec's
 * "Strategy Evolution" section. Deliberately built on data Growth OS
 * already owns (campaigns, campaign_assets, content_scores, signals,
 * creators) rather than FillbookHQ's separate production database, which
 * this project has no read access to and isn't meant to share (see
 * docs/ARCHITECTURE.md). That means "conversion quality" inputs the
 * master spec lists aren't available yet -- this uses the best available
 * proxies (review pass rate, how far a draft got, signal velocity) and
 * says so explicitly rather than pretending they're the same thing.
 */

export interface TopicStats {
  /** The opportunity's title -- the closest thing to a "topic" this schema has. */
  topic: string;
  opportunityId: string;
  campaignCount: number;
  reachedReadyForOwnerCount: number;
  totalContentScorePasses: number;
  totalContentScoreFails: number;
  latestOpportunityScore: number;
}

export interface FormatStats {
  platform: string;
  assetType: string;
  assetCount: number;
  reachedReadyForOwnerCount: number;
  totalContentScorePasses: number;
  totalContentScoreFails: number;
}

export interface SeoOpportunityCandidate {
  topic: string;
  velocity: number;
  hasExistingOpportunity: boolean;
}

export interface CreatorOpportunityCandidate {
  id: string;
  handle: string;
  category: "tier_b" | "research_next";
  readinessScore: number | null;
  daysSinceLastInteraction: number | null;
}

export interface StrategyEngineInput {
  topicStats: TopicStats[];
  formatStats: FormatStats[];
  seoCandidates: SeoOpportunityCandidate[];
  creatorCandidates: CreatorOpportunityCandidate[];
  now: Date;
}

export interface TopicRecommendation {
  topic: string;
  reason: string;
}

export interface FormatRecommendation {
  platform: string;
  assetType: string;
  reason: string;
}

export interface ExperimentSuggestion {
  hypothesis: string;
  rationale: string;
}

export interface StrategyRecommendation {
  topicsToIncrease: TopicRecommendation[];
  topicsToDecrease: TopicRecommendation[];
  contentToRetire: TopicRecommendation[];
  formatsToTest: FormatRecommendation[];
  seoOpportunities: SeoOpportunityCandidate[];
  creatorOpportunities: CreatorOpportunityCandidate[];
  experimentsToRun: ExperimentSuggestion[];
  summary: string;
  /** True when most groups had too little data (see MIN_SAMPLE_SIZE) to
   * recommend anything with confidence -- surfaced so nobody mistakes a
   * thin first report for a mature strategy read. */
  lowConfidence: boolean;
}

export interface StrategyVersion extends StrategyRecommendation {
  id: string;
  version: number;
  generatedAt: string;
}

export interface StrategyRepository {
  getLatest(): Promise<StrategyVersion | null>;
  listHistory(limit: number): Promise<StrategyVersion[]>;
  save(recommendation: StrategyRecommendation): Promise<StrategyVersion>;
}
