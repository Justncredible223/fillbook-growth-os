import type { LlmClient } from "./llmClient.js";
import { runReviewAgent, type ReviewAgentName, type ReviewContext, type ReviewVerdict } from "./reviewAgents.js";

export interface DeepReviewResult {
  passed: boolean;
  verdicts: ReviewVerdict[];
  blockReasons: string[];
}

/**
 * The nine agents from the master spec, mapped to which pipeline stage
 * they gate. Not every agent runs on every submission -- trader/
 * hook_specialist/copy_editor/growth_strategist are about whether the
 * draft is good; fact_checker/brand_guardian/integrity_reviewer/
 * skeptic/conversion_reviewer are about whether it's safe/on-brand to
 * ship. Running all nine on every draft is the default (personal-use,
 * low volume -- cost isn't the constraint) but callers can pass a
 * narrower list.
 */
export const ALL_REVIEW_AGENTS: ReviewAgentName[] = [
  "trader",
  "hook_specialist",
  "copy_editor",
  "skeptic",
  "brand_guardian",
  "growth_strategist",
  "fact_checker",
  "integrity_reviewer",
  "conversion_reviewer",
];

/**
 * Runs the given review agents against a candidate and aggregates into a
 * single pass/fail, same shape as ContentQualityGate.check() so
 * CampaignFactory can treat both gates uniformly. Passes only if every
 * agent passes -- deliberately strict, matching the project's existing
 * anti-fabrication/no-half-finished posture rather than a majority vote
 * that could let one agent's real objection get outvoted.
 */
export async function runDeepReview(
  client: LlmClient,
  agents: ReviewAgentName[],
  candidateText: string,
  context: ReviewContext,
): Promise<DeepReviewResult> {
  const verdicts = await Promise.all(agents.map((agent) => runReviewAgent(client, agent, candidateText, context)));

  const failing = verdicts.filter((v) => !v.pass);
  const blockReasons = failing.map((v) => `${v.agent}: ${v.reasoning}`);

  return {
    passed: failing.length === 0,
    verdicts,
    blockReasons,
  };
}
