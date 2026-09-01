import type { ScoringInput, Urgency } from "./types.js";

export interface ScoreResult {
  score: number; // 0-100
  urgency: Urgency;
  rationale: string;
}

const TOPIC_FATIGUE_WINDOW_DAYS = 14;
const MAX_DUPLICATE_PENALTY = 30;

/**
 * Pure scoring function — see master spec's Opportunity Engine section:
 * score inputs (audience demand, demand acceleration/velocity, freshness,
 * Fillbook relevance, evidence strength) minus penalties (topic fatigue,
 * weak evidence, duplicate coverage). No I/O, fully unit-testable.
 */
export function scoreOpportunity(input: ScoringInput): ScoreResult {
  const reasons: string[] = [];

  const audiencePoints = input.audienceRelevance * 30;
  reasons.push(`audience relevance ${(input.audienceRelevance * 100).toFixed(0)}% -> +${audiencePoints.toFixed(1)}`);

  const relevancePoints = input.fillbookRelevance * 30;
  reasons.push(`Fillbook relevance ${(input.fillbookRelevance * 100).toFixed(0)}% -> +${relevancePoints.toFixed(1)}`);

  const evidencePoints = input.confidence * 20;
  reasons.push(`evidence confidence ${(input.confidence * 100).toFixed(0)}% -> +${evidencePoints.toFixed(1)}`);

  const velocityScore = Math.min(input.velocity / 5, 1) * 20;
  reasons.push(`velocity ${input.velocity} signals/24h -> +${velocityScore.toFixed(1)}`);

  let score = audiencePoints + relevancePoints + evidencePoints + velocityScore;

  if (input.confidence < 0.4) {
    const penalty = 15;
    score -= penalty;
    reasons.push(`weak evidence penalty (confidence < 0.4) -> -${penalty}`);
  }

  if (
    input.daysSinceLastCoveredSameTopic !== null &&
    input.daysSinceLastCoveredSameTopic < TOPIC_FATIGUE_WINDOW_DAYS
  ) {
    const fraction = 1 - input.daysSinceLastCoveredSameTopic / TOPIC_FATIGUE_WINDOW_DAYS;
    const penalty = fraction * 25;
    score -= penalty;
    reasons.push(
      `topic fatigue: covered ${input.daysSinceLastCoveredSameTopic}d ago (<${TOPIC_FATIGUE_WINDOW_DAYS}d window) -> -${penalty.toFixed(1)}`,
    );
  }

  if (input.duplicateOpenCount > 0) {
    const penalty = Math.min(input.duplicateOpenCount * 10, MAX_DUPLICATE_PENALTY);
    score -= penalty;
    reasons.push(`${input.duplicateOpenCount} duplicate open opportunit${input.duplicateOpenCount === 1 ? "y" : "ies"} -> -${penalty}`);
  }

  score = Math.max(0, Math.min(100, score));

  let urgency: Urgency = "normal";
  if (input.velocity >= 5 || score >= 75) urgency = "high";
  else if (score < 30) urgency = "low";

  return {
    score: Math.round(score * 100) / 100,
    urgency,
    rationale: reasons.join("; "),
  };
}
