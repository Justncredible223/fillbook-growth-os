import type { Opportunity } from "./types.js";

/**
 * Owner-requested research topic (2026-09-07): mirrors manualVideoTopic.ts
 * exactly -- lets the owner type a research question/topic directly and
 * have it flow through the EXACT same runCampaignForOpportunity /
 * runCampaignPipeline machinery every other opportunity already uses
 * (mechanical gate, budget/paused gate, and the existing listOpen()-based
 * idempotency) by first creating a real (if minimal) `opportunities` row
 * for it, entirely in application code, no migration required.
 */

/** Every manually-created research-topic opportunity's title starts with this, so a later request for the identical topic can be recognized without a dedicated column. */
export const MANUAL_RESEARCH_TOPIC_TITLE_PREFIX = "Research request: ";

export const MIN_RESEARCH_TOPIC_LENGTH = 3;
export const MAX_RESEARCH_TOPIC_LENGTH = 200;

/** Collapses internal whitespace and trims -- the same string two callers type with different spacing/casing should canonicalize to the same duplicate-detection key. */
export function normalizeResearchTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ");
}

export interface ResearchTopicValidationError {
  reason: string;
}

/**
 * Pure length/shape validation only -- deliberately NOT topic-relevance
 * checking (that's isPlausiblyTradingRelated's job, run separately, same
 * separation-of-concerns as manualVideoTopic.ts's validateVideoTopicShape).
 */
export function validateResearchTopicShape(topic: unknown): ResearchTopicValidationError | null {
  if (typeof topic !== "string") return { reason: "topic must be a string." };
  const normalized = normalizeResearchTopic(topic);
  if (normalized.length < MIN_RESEARCH_TOPIC_LENGTH) {
    return { reason: `topic must be at least ${MIN_RESEARCH_TOPIC_LENGTH} characters.` };
  }
  if (normalized.length > MAX_RESEARCH_TOPIC_LENGTH) {
    return { reason: `topic must be ${MAX_RESEARCH_TOPIC_LENGTH} characters or fewer.` };
  }
  return null;
}

/** The canonical title a manual research-topic opportunity is stored (and later looked up) under -- an exact, case-insensitive match on this is what the duplicate-prevention check in api/run-campaign.ts keys on. */
export function manualResearchTopicTitle(topic: string): string {
  return `${MANUAL_RESEARCH_TOPIC_TITLE_PREFIX}${normalizeResearchTopic(topic)}`;
}

/**
 * Builds the insert payload for a new manual research-topic opportunity.
 * Fixed, maximal score/confidence -- unlike a signal-derived opportunity,
 * there is no separate scoring model for "the owner explicitly typed this
 * in and asked for it"; the owner's own request IS the evidence.
 * recommendedChannels is deliberately empty -- research isn't routed to
 * any particular platform's writer, it's routed to the research writer
 * purely via the caller's own explicit assetType: "research" request.
 */
export function manualResearchTopicOpportunityInput(topic: string): Omit<Opportunity, "id" | "status" | "createdAt"> {
  return {
    title: manualResearchTopicTitle(topic),
    score: 100,
    urgency: "normal",
    confidence: 1,
    rationale: `Owner-requested research topic, entered directly in the app: "${normalizeResearchTopic(topic)}"`,
    recommendedChannels: [],
    recommendedCampaignType: null,
    approvalClass: "EXTERNAL_DRAFT",
    signalIds: [],
  };
}
