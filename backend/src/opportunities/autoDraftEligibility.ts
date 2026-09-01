import type { Opportunity } from "./types.js";

/**
 * Every threshold here is a real, documented policy decision, not a
 * placeholder -- see docs/PROGRESS_LEDGER.md's auto-draft section for
 * the reasoning behind each number.
 */

/**
 * Minimum score to qualify for unattended auto-drafting. Grounded in
 * real observed scores from this system's own opportunity generator: the
 * one genuinely strong, evidence-backed opportunity seen so far scored
 * 78.5; routine/weak signals (a bare "true!!" reply, etc.) score in the
 * high 30s-40s. 50 sits above the weak band and below "obviously
 * strong," and is deliberately conservative -- a human can still act on
 * anything below this manually via POST /api/run-campaign with an
 * explicit opportunityId.
 */
export const MIN_QUALIFYING_SCORE = 50;

/** Opportunities older than this are excluded from auto-draft (still visible/usable manually). */
export const STALE_WINDOW_DAYS = 7;

/** Max unreviewed (ready_for_owner) drafts allowed to sit in the queue before auto-draft skips for the day. */
export const BACKLOG_CAP = 3;

/**
 * Hard monthly ceiling on auto-draft spend. A single full run (1 draft +
 * up to 9 review calls) has been observed to cost ~$0.086. At most 1
 * auto-draft/day (~31/month) would cost roughly $2.67 at that rate --
 * $5/month gives real headroom for larger drafts/review text without
 * being an open-ended commitment.
 */
export const MONTHLY_AUTO_DRAFT_BUDGET_USD = 5.0;

/** A single auto-draft run should never exceed 1 draft call + 9 review-agent calls. */
export const MAX_CALLS_PER_RUN = 10;

export interface EligibilityCheckResult {
  eligible: boolean;
  reason?: string;
}

export function isStale(opportunity: Opportunity, now: Date): boolean {
  const ageDays = (now.getTime() - opportunity.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_WINDOW_DAYS;
}

/**
 * Filters open opportunities down to auto-draft-eligible ones: score
 * above the qualifying threshold, not stale, and not already represented
 * by an existing campaign (regardless of that campaign's outcome --
 * retrying a failed opportunity automatically is not "genuinely new"
 * content and stays a deliberate manual action).
 */
export function filterEligibleOpportunities(
  openOpportunities: Opportunity[],
  opportunityIdsWithExistingCampaigns: ReadonlySet<string>,
  now: Date,
): Opportunity[] {
  return openOpportunities.filter((o) => {
    if (o.score < MIN_QUALIFYING_SCORE) return false;
    if (isStale(o, now)) return false;
    if (opportunityIdsWithExistingCampaigns.has(o.id)) return false;
    return true;
  });
}

/**
 * Picks the single best qualifying opportunity, or null if none qualify
 * -- "no draft" is a correct, expected result, not a failure.
 * openOpportunities is expected sorted score-descending (as
 * OpportunityRepository.listOpen() already returns), so the first
 * eligible entry is the best one.
 */
export function selectBestQualifyingOpportunity(
  openOpportunities: Opportunity[],
  opportunityIdsWithExistingCampaigns: ReadonlySet<string>,
  now: Date,
): Opportunity | null {
  const eligible = filterEligibleOpportunities(openOpportunities, opportunityIdsWithExistingCampaigns, now);
  return eligible[0] ?? null;
}

export function evaluateBacklog(readyForOwnerCount: number): EligibilityCheckResult {
  if (readyForOwnerCount >= BACKLOG_CAP) {
    return { eligible: false, reason: `backlog_cap_reached (${readyForOwnerCount} unreviewed drafts already waiting, cap is ${BACKLOG_CAP})` };
  }
  return { eligible: true };
}

export function evaluateMonthlyBudget(monthSpendUsd: number): EligibilityCheckResult {
  if (monthSpendUsd >= MONTHLY_AUTO_DRAFT_BUDGET_USD) {
    return {
      eligible: false,
      reason: `monthly_budget_reached ($${monthSpendUsd.toFixed(4)} spent, cap is $${MONTHLY_AUTO_DRAFT_BUDGET_USD.toFixed(2)})`,
    };
  }
  return { eligible: true };
}
