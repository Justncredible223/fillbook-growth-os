/**
 * Cost/volume guardrails for Prospecting's X search -- same pattern as
 * opportunities/autoDraftEligibility.ts (pure eligibility checks, real
 * documented reasoning per threshold, no I/O). X search reads bill at the
 * general $0.005/read rate (not the cheap $0.001 Owned Reads tier used for
 * mentions), against the same shared $10 X API credit pool documented in
 * docs/PROGRESS_LEDGER.md Phase 4.
 */

import { currentScheduleSlot, getScheduleTimezone, getXProspectingSchedule } from "../config/scheduleConfig.js";

/**
 * How many of PROSPECTING_TOPICS get searched per growth-pulse run --
 * rotates through the full list over time rather than querying everything
 * at once. QUEUE_FULL_THRESHOLD below still stops search entirely once 2
 * days' worth of backlog is queued, so this can't overrun the owner's
 * strict 8-15 candidates/day reply cadence (shadowban-risk discipline) --
 * it only controls how much TOPIC DIVERSITY shows up per run while the
 * queue is empty/low.
 *
 * Raised from 1 to 2 (2026-09-07): at 1 topic/run * 3 runs/day, every
 * candidate found in one run came from the exact same search topic (real
 * example: a run that found 4 candidates, all under "too_many_trades"),
 * and the full ~35-topic list took ~14 days to cycle once. At 2/run * 3
 * runs/day = 6 topics/day, the full list cycles in under a week, and a
 * single run is no longer guaranteed to be single-topic. Cost impact: see
 * MONTHLY_PROSPECTING_BUDGET_USD's own comment -- still self-limiting,
 * still well under the shared $10 credit pool even at this run's real,
 * lower-than-ceiling read counts.
 */
export const TOPICS_PER_SEARCH_RUN = 2;

/** X's own minimum for max_results on this endpoint; going lower wastes a call for no benefit. Lowered from 15 -- 10 is still X's floor, and cuts read volume ~33% per query with no coverage loss that matters for a rotating discovery feed. */
export const RESULTS_PER_QUERY = 10;

/**
 * The three daily X-prospecting-and-inbound growth-pulse invocations -- approved final
 * schedule is 08:00/13:00/18:00 America/Phoenix (configurable via
 * X_PROSPECTING_TIMES/SCHEDULE_TIMEZONE, see
 * backend/src/config/scheduleConfig.ts, the single source of truth this
 * now reads from instead of a locally-hardcoded UTC array). Must be kept
 * in sync with .github/workflows/growth-pulse.yml's cron schedule, which
 * calls /api/growth-pulse at the equivalent fixed UTC times (safe to
 * fix in UTC because America/Phoenix never observes DST -- see
 * scheduleConfig.ts's doc comment). currentRunSlot() below maps whatever
 * time a run actually fires at back to the nearest configured slot, so a
 * few minutes of scheduler jitter never miscounts which slot this is.
 */
export function currentRunSlot(now: Date): number {
  return currentScheduleSlot(getXProspectingSchedule(), getScheduleTimezone(), now);
}

/** Number of X-prospecting run slots/day -- used to size the topic-rotation index. Derived from config, not a separate literal. */
export function runSlotsPerDay(): number {
  return getXProspectingSchedule().length;
}

/**
 * If this many non-terminal candidates (new/shown/drafting/ready -- the
 * same pool prospectingDailySelection.ts draws "today's set" from) are
 * already queued, skip searching for more today. Derived from the actual
 * daily target rather than picked blindly: DAILY_SET_MAX (15) * 2 = two
 * full days' worth of max-quality inventory already sitting available.
 * "Use existing quality inventory before spending to create more" --
 * discovery resumes on its own once the owner works the backlog down
 * below this.
 */
export const QUEUE_FULL_THRESHOLD = 30; // 2 * DAILY_SET_MAX (kept as a literal -- see prospectingDailySelection.ts for the source constant)

/**
 * A non-terminal candidate this old has almost certainly scrolled off
 * relevance -- the conversation it belonged to has moved on. Matches
 * opportunities/scoring.ts's own TOPIC_FATIGUE_WINDOW_DAYS (14) for
 * consistency across the codebase's two "how long before this goes
 * stale" judgment calls, rather than inventing an unrelated number.
 */
export const STALE_EXPIRY_DAYS = 14;

/**
 * Conservative monthly ceiling, leaving real headroom under the $10
 * deposited credit shared with mentions ingestion (which costs fractions
 * of a cent per run). At TOPICS_PER_SEARCH_RUN=2 * RESULTS_PER_QUERY=10 *
 * $0.005 = $0.10/run, 3 runs/day * 30 days = $9.00/month uncapped in
 * theory -- this cap (unchanged at $8) is what actually keeps that under
 * the shared $10 pool; real spend runs lower in practice since most
 * queries return fewer than the full 10 results once the freshness/
 * dedup filters apply (this codebase's own recorded cost_events, not
 * just the theoretical ceiling, is what evaluateMonthlyBudget checks).
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

/** Pure predicate -- true if a non-terminal candidate's discoveredAt is older than STALE_EXPIRY_DAYS. Used by the repository's expireStale() before each daily-set selection so a months-old unactioned post never resurfaces as if freshly found. */
export function isStaleCandidate(discoveredAt: string, now: Date): boolean {
  const ageMs = now.getTime() - new Date(discoveredAt).getTime();
  return ageMs > STALE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
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
