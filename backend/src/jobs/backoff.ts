/**
 * Pure retry/backoff decision — no I/O, fully unit-testable. The DB layer
 * (fail_job) just applies whatever this function decides.
 */
export interface RetryDecision {
  deadLetter: boolean;
  runAfter: Date;
}

const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 30 * 60_000; // 30 min cap

export function decideRetry(
  attemptsAfterThisFailure: number,
  maxAttempts: number,
  now: Date = new Date(),
): RetryDecision {
  if (attemptsAfterThisFailure >= maxAttempts) {
    return { deadLetter: true, runAfter: now };
  }
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attemptsAfterThisFailure - 1), MAX_DELAY_MS);
  return { deadLetter: false, runAfter: new Date(now.getTime() + delay) };
}
