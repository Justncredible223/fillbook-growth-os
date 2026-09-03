import type { ProspectingCandidate } from "./types.js";

/**
 * Turns the accumulated candidate pool into a real daily working set --
 * "8-15 strongest opportunities/day WHEN that much quality exists" is a
 * directional target (2026-09-03 growth review), not a quota to force-fill.
 * This is the SELECT DAILY WORKING SET step in DISCOVER -> FILTER -> RANK
 * -> SELECT DAILY WORKING SET -> DRAFT -> HUMAN REVIEW -> ... -- everything
 * before this point (search, spam exclusion, scoring) already happened in
 * prospectingSearch.ts/prospectingScoring.ts; this only re-ranks and caps
 * what's already a clean, scored pool.
 */
export const DAILY_SET_MIN = 8;
export const DAILY_SET_MAX = 15;

/**
 * Grounded in this project's own first real search run (2026-09-03): after
 * manual editorial review removed spam/promo/off-topic noise, the 43
 * genuine survivors scored min 38.4, median 45.9, p25 43.7, max 69.9. 40
 * sits just under that real p25 -- excludes roughly the weakest quarter of
 * already-vetted candidates from today's set (they stay in backlog for a
 * day they might rank better on, not discarded) without needing an
 * invented number.
 */
export const MIN_DAILY_SET_SCORE = 40;

export interface DailySelectionResult {
  selected: ProspectingCandidate[];
  /** Eligible candidates that scored high enough but lost out to the one-per-author rule or the 15-cap -- still real backlog, not discarded. */
  deferred: ProspectingCandidate[];
  /** Eligible candidates that simply didn't clear MIN_DAILY_SET_SCORE. */
  belowQualityBar: ProspectingCandidate[];
}

/**
 * Selects today's working set from an already-scored, already-clean
 * candidate pool (spam/promo already excluded upstream). Pure function --
 * no I/O, easy to test against real exported data.
 *
 * Rules, in order:
 * 1. Sort by opportunity_score descending (ties broken by more recent
 *    discovery first, so a fresher post wins a tie over a stale one).
 * 2. Drop anything under MIN_DAILY_SET_SCORE -- never force-fill weak
 *    posts just to hit a count.
 * 3. At most one candidate per author per day ("Avoid interacting
 *    repeatedly with the same account simply because search surfaced
 *    multiple posts. One strong interaction is better than looking
 *    automated.") -- keeps that author's highest-scored post, defers the
 *    rest.
 * 4. Cap at DAILY_SET_MAX. If fewer than DAILY_SET_MAX/DAILY_SET_MIN
 *    survive steps 2-3, that's a correct, expected result -- show fewer,
 *    not padding.
 */
export function selectDailyWorkingSet(candidates: ProspectingCandidate[]): DailySelectionResult {
  const sorted = [...candidates].sort((a, b) => {
    if (b.opportunityScore !== a.opportunityScore) return b.opportunityScore - a.opportunityScore;
    return new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime();
  });

  const belowQualityBar = sorted.filter((c) => c.opportunityScore < MIN_DAILY_SET_SCORE);
  const eligible = sorted.filter((c) => c.opportunityScore >= MIN_DAILY_SET_SCORE);

  const seenAuthors = new Set<string>();
  const selected: ProspectingCandidate[] = [];
  const deferred: ProspectingCandidate[] = [];

  for (const candidate of eligible) {
    const authorKey = candidate.authorExternalId ?? candidate.authorHandle ?? candidate.id;
    const alreadyPicked = seenAuthors.has(authorKey);
    if (!alreadyPicked && selected.length < DAILY_SET_MAX) {
      seenAuthors.add(authorKey);
      selected.push(candidate);
    } else {
      deferred.push(candidate);
    }
  }

  return { selected, deferred, belowQualityBar };
}
