import type { Opportunity } from "./types.js";

/**
 * Owner-requested video topic (2026-09-08): the TikTok/YouTube signal
 * adapters that used to produce video-first opportunities were
 * intentionally removed (see api/ingest.ts's own doc comment), which left
 * the fully-implemented video-script pipeline permanently unreachable
 * through the normal discovery flow. This lets the owner type a topic
 * directly and have it flow through the EXACT same
 * runCampaignForOpportunity / runCampaignPipeline machinery every other
 * opportunity already uses -- review agents, grounding, budget/paused
 * gate, and the existing listOpen()-based idempotency -- by first
 * creating a real (if minimal) `opportunities` row for it, entirely in
 * application code, no migration required (every column this needs
 * already exists and already has a sensible default).
 */

/** Every manually-created video-topic opportunity's title starts with this, so a later request for the identical topic can be recognized without a dedicated column. */
export const MANUAL_VIDEO_TOPIC_TITLE_PREFIX = "Video request: ";

export const MIN_VIDEO_TOPIC_LENGTH = 3;
export const MAX_VIDEO_TOPIC_LENGTH = 200;

/** Collapses internal whitespace and trims -- the same string two callers type with different spacing/casing should canonicalize to the same duplicate-detection key. */
export function normalizeVideoTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ");
}

export interface VideoTopicValidationError {
  reason: string;
}

/**
 * Pure length/shape validation only -- deliberately NOT topic-relevance
 * checking (that's isPlausiblyTradingRelated's job, run separately so a
 * caller can distinguish "malformed input" from "off-topic content"
 * failures, same separation-of-concerns already used by
 * loadApprovedScript.ts's validate-vs-assertApproved split).
 */
export function validateVideoTopicShape(topic: unknown): VideoTopicValidationError | null {
  if (typeof topic !== "string") return { reason: "topic must be a string." };
  const normalized = normalizeVideoTopic(topic);
  if (normalized.length < MIN_VIDEO_TOPIC_LENGTH) {
    return { reason: `topic must be at least ${MIN_VIDEO_TOPIC_LENGTH} characters.` };
  }
  if (normalized.length > MAX_VIDEO_TOPIC_LENGTH) {
    return { reason: `topic must be ${MAX_VIDEO_TOPIC_LENGTH} characters or fewer.` };
  }
  return null;
}

/** The canonical title a manual video-topic opportunity is stored (and later looked up) under -- an exact, case-insensitive match on this is what the duplicate-prevention check in api/run-campaign.ts keys on. */
export function manualVideoTopicTitle(topic: string): string {
  return `${MANUAL_VIDEO_TOPIC_TITLE_PREFIX}${normalizeVideoTopic(topic)}`;
}

/**
 * Builds the insert payload for a new manual video-topic opportunity.
 * Fixed, maximal score/confidence -- unlike a signal-derived opportunity,
 * there is no separate scoring model for "the owner explicitly typed this
 * in and asked for it"; the owner's own request IS the evidence.
 * recommendedChannels is deliberately empty (not "tiktok") -- this
 * opportunity is routed to the video writer purely via the caller's own
 * explicit assetType: "video_script" request, never inferred from a
 * channel this opportunity doesn't actually have.
 */
export function manualVideoTopicOpportunityInput(topic: string): Omit<Opportunity, "id" | "status" | "createdAt"> {
  return {
    title: manualVideoTopicTitle(topic),
    score: 100,
    urgency: "normal",
    confidence: 1,
    rationale: `Owner-requested video topic, entered directly in the app: "${normalizeVideoTopic(topic)}"`,
    recommendedChannels: [],
    recommendedCampaignType: null,
    approvalClass: "EXTERNAL_DRAFT",
    signalIds: [],
  };
}
