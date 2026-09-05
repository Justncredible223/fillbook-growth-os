/**
 * Cost/volume guardrails for Reddit prospecting -- the Reddit equivalent of
 * prospectingEligibility.ts. Reddit's free tier has no per-call dollar
 * cost the way X's search does (see docs/REDDIT_INTEGRATION.md for the
 * verified/assumption split on Reddit's API terms), so there is no
 * monthly-budget-in-dollars gate here. The real constraint is Reddit's
 * documented 100 requests/minute per-OAuth-client rate limit and the
 * "~3-4 worthwhile candidates/day" target -- both satisfied by keeping
 * request volume small and bounded, not by a spend cap.
 */

/** How many of REDDIT_TOPICS get searched per Reddit-prospecting run (1x/day). Small and bounded: at 2 subreddits/run x up to REDDIT_RESULTS_PER_QUERY results each, this comfortably clears the 3-4/day target after relevance filtering without over-fetching. */
export const REDDIT_TOPICS_PER_RUN = 2;

/** Max posts requested per subreddit search call -- bounded so a single run can never balloon into a large read regardless of how many topics are configured. */
export const REDDIT_RESULTS_PER_QUERY = 8;

/** Max inbox items pulled per Reddit-inbound run. Reddit's inbox listing is small in practice for a low-volume account; this just bounds the worst case. */
export const REDDIT_INBOX_LIMIT_PER_RUN = 25;

/**
 * Same reasoning as prospecting's QUEUE_FULL_THRESHOLD, sized to Reddit's
 * much smaller ~3-4/day target instead of X's ~15/day: 2 days' worth of
 * max-quality inventory (2 * 4) already queued means searching for more
 * doesn't produce more usable replies, just more unactioned backlog.
 */
export const REDDIT_QUEUE_FULL_THRESHOLD = 8;

export interface EligibilityCheckResult {
  eligible: boolean;
  reason?: string;
}

export function evaluateRedditQueueCapacity(unshownCandidateCount: number): EligibilityCheckResult {
  if (unshownCandidateCount >= REDDIT_QUEUE_FULL_THRESHOLD) {
    return {
      eligible: false,
      reason: `queue_full (${unshownCandidateCount} unshown Reddit candidates already queued, threshold is ${REDDIT_QUEUE_FULL_THRESHOLD})`,
    };
  }
  return { eligible: true };
}
