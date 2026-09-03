/**
 * Cost/volume guardrails for Prospecting's X search -- same pattern as
 * opportunities/autoDraftEligibility.ts (pure eligibility checks, real
 * documented reasoning per threshold, no I/O). X search reads bill at the
 * general $0.005/read rate (not the cheap $0.001 Owned Reads tier used for
 * mentions), against the same shared $10 X API credit pool documented in
 * docs/PROGRESS_LEDGER.md Phase 4.
 */

/** How many of PROSPECTING_TOPICS get searched per daily-pipeline run -- rotates through the full list over several days rather than querying everything at once. */
export const TOPICS_PER_SEARCH_RUN = 6;

/** X's own minimum for max_results on this endpoint; going lower wastes a call for no benefit. */
export const RESULTS_PER_QUERY = 15;

/**
 * If this many unshown ('new'/'shown') candidates are already queued,
 * skip searching for more today -- surfacing "enough for 8-15 replies,"
 * per the actual operating goal, not maximum possible volume. Re-search
 * resumes once the owner works the queue down.
 */
export const QUEUE_FULL_THRESHOLD = 25;

/**
 * Conservative monthly ceiling, leaving real headroom under the $10
 * deposited credit shared with mentions ingestion (which costs
 * fractions of a cent per run). At TOPICS_PER_SEARCH_RUN=6 *
 * RESULTS_PER_QUERY=15 * $0.005 = $0.45/day, ~30 days would be $13.50
 * uncapped -- this cap stops real spend before that, using actual
 * recorded cost_events rows, not just the theoretical estimate.
 */
export const MONTHLY_PROSPECTING_BUDGET_USD = 8.0;

export interface EligibilityCheckResult {
  eligible: boolean;
  reason?: string;
}

export function evaluateQueueCapacity(unshownCandidateCount: number): EligibilityCheckResult {
  if (unshownCandidateCount >= QUEUE_FULL_THRESHOLD) {
    return {
      eligible: false,
      reason: `queue_full (${unshownCandidateCount} unshown candidates already queued, threshold is ${QUEUE_FULL_THRESHOLD})`,
    };
  }
  return { eligible: true };
}

export function evaluateMonthlyBudget(monthSpendUsd: number): EligibilityCheckResult {
  if (monthSpendUsd >= MONTHLY_PROSPECTING_BUDGET_USD) {
    return {
      eligible: false,
      reason: `monthly_budget_reached ($${monthSpendUsd.toFixed(4)} spent, cap is $${MONTHLY_PROSPECTING_BUDGET_USD.toFixed(2)})`,
    };
  }
  return { eligible: true };
}

/**
 * Deterministic day-based rotation through the full topic list so
 * TOPICS_PER_SEARCH_RUN queries per day still cover every configured
 * topic over time, instead of always hitting the same first N. `dayIndex`
 * is meant to be something like days-since-epoch so it advances daily and
 * wraps around the topic list.
 */
export function selectTopicsForRun<T>(topics: readonly T[], dayIndex: number, count: number): T[] {
  if (topics.length === 0) return [];
  const start = dayIndex * count % topics.length;
  const selected: T[] = [];
  for (let i = 0; i < Math.min(count, topics.length); i++) {
    selected.push(topics[(start + i) % topics.length]!);
  }
  return selected;
}
