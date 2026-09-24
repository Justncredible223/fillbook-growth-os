import type { Opportunity } from "./types.js";
import { MOTION_CONCEPT_REF_PREFIX } from "../../scripts/video-factory/motionCatalog.js";
import type { MotionConceptSummary } from "../../scripts/video-factory/motionCatalog.js";

/**
 * Owner-requested MOTION-BACKED video concept -- the sibling of
 * manualVideoTopic.ts's free-text path, for "Create Fillbook Video"
 * requesting one of the small, fixed set of concepts that have real
 * verified product-motion footage (see motionCatalog.ts's
 * listMotionConcepts) instead of a custom topic. Reuses the EXACT same
 * opportunity-based enqueue mechanism every other request already goes
 * through (runCampaignForOpportunity / runCampaignPipeline / the mechanical
 * gate / the nine-agent deep review) -- no new table, no migration: the
 * concept id rides inside `rationale`, a plain text column that already
 * exists, behind a fixed, server-only-written prefix
 * (MOTION_CONCEPT_REF_PREFIX) that campaignPipeline.ts recognizes and
 * parses BEFORE drafting -- see its own doc comment. This is different
 * from (and doesn't touch) the render-time motionScenePlan reference
 * embedded in the generated VideoScript itself, which is what render-single.ts
 * actually checks -- this rationale marker only gets the request from the
 * app to the campaign-generation step; buildVideoScriptFromScenePlan is
 * what stamps the real, hash-verified reference onto the script.
 */

/** Every manually-created motion-concept opportunity's title starts with this, so a later request for the identical concept can be recognized without a dedicated column (same pattern as MANUAL_VIDEO_TOPIC_TITLE_PREFIX). */
export const MANUAL_MOTION_CONCEPT_TITLE_PREFIX = "Motion concept request: ";

export function manualMotionConceptTitle(concept: MotionConceptSummary): string {
  return `${MANUAL_MOTION_CONCEPT_TITLE_PREFIX}${concept.title}`;
}

/**
 * Builds the insert payload for a new manual motion-concept opportunity.
 * Fixed, maximal score/confidence, same reasoning as manualVideoTopicOpportunityInput:
 * the owner's own request IS the evidence, there's no separate scoring model.
 */
export function manualMotionConceptOpportunityInput(concept: MotionConceptSummary): Omit<Opportunity, "id" | "status" | "createdAt"> {
  return {
    title: manualMotionConceptTitle(concept),
    score: 100,
    urgency: "normal",
    confidence: 1,
    // Human-readable (this can surface in a Radar list like any other
    // opportunity, e.g. if generation fails and the owner re-triggers a
    // still-"open" stuck draft) WITH the machine-parseable marker as its
    // own trailing token -- extractMotionConceptRefFromRationale finds it
    // anywhere in the string, not only as a strict prefix.
    rationale: `Owner-requested motion-backed video concept, entered directly in the app: "${concept.title}". ${MOTION_CONCEPT_REF_PREFIX}${concept.id}`,
    recommendedChannels: [],
    recommendedCampaignType: null,
    approvalClass: "EXTERNAL_DRAFT",
    signalIds: [],
  };
}
