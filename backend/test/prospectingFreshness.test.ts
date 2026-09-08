import { describe, it, expect } from "vitest";
import {
  currentPostAgeMs,
  effectiveScoreForSelection,
  isEligibleForDailySelection,
  recencyDecayMultiplier,
  MAX_AGE_FOR_DAILY_SELECTION_MS,
  RECENCY_DECAY_START_MS,
} from "../src/prospecting/prospectingFreshness";

const NOW = new Date("2026-09-07T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

describe("currentPostAgeMs", () => {
  it("returns null for a missing postCreatedAt -- no evidence to compute an age from", () => {
    expect(currentPostAgeMs(null, NOW)).toBeNull();
  });

  it("returns null for an unparseable postCreatedAt rather than NaN", () => {
    expect(currentPostAgeMs("not a real date", NOW)).toBeNull();
  });

  it("returns the real elapsed milliseconds for a valid timestamp", () => {
    expect(currentPostAgeMs(hoursAgo(5), NOW)).toBe(5 * HOUR);
  });
});

describe("recencyDecayMultiplier", () => {
  it("applies no penalty for a post right now", () => {
    expect(recencyDecayMultiplier(hoursAgo(0), NOW)).toBe(1);
  });

  it("applies no penalty anywhere up to and including 24h old", () => {
    expect(recencyDecayMultiplier(hoursAgo(1), NOW)).toBe(1);
    expect(recencyDecayMultiplier(hoursAgo(24), NOW)).toBe(1);
    expect(recencyDecayMultiplier(new Date(NOW.getTime() - RECENCY_DECAY_START_MS).toISOString(), NOW)).toBe(1);
  });

  it("decays meaningfully for a 48h-old post -- partway between the 24h and 72h boundaries", () => {
    const multiplier = recencyDecayMultiplier(hoursAgo(48), NOW);
    expect(multiplier).toBeLessThan(1);
    expect(multiplier).toBeGreaterThan(0.45); // still above the 72h floor
    expect(multiplier).toBeCloseTo(0.725, 2); // halfway through the 24h-72h decay range
  });

  it("reaches its floor at exactly the 72h cutoff, never below it", () => {
    const atCutoff = recencyDecayMultiplier(new Date(NOW.getTime() - MAX_AGE_FOR_DAILY_SELECTION_MS).toISOString(), NOW);
    expect(atCutoff).toBeCloseTo(0.45, 5);
  });

  it("never penalizes a candidate with an unknown post time -- missing data is not treated as stale", () => {
    expect(recencyDecayMultiplier(null, NOW)).toBe(1);
  });

  it("clamps at the floor for a post far past 72h -- even though it will separately be excluded by eligibility, the multiplier itself never goes negative or keeps falling", () => {
    const wayOld = recencyDecayMultiplier(hoursAgo(24 * 30), NOW);
    expect(wayOld).toBeCloseTo(0.45, 5);
  });
});

describe("effectiveScoreForSelection", () => {
  it("returns the stored score unchanged for a fresh post", () => {
    expect(effectiveScoreForSelection(70, hoursAgo(1), NOW)).toBe(70);
  });

  it("returns a reduced score for a 48h-old post", () => {
    const effective = effectiveScoreForSelection(70, hoursAgo(48), NOW);
    expect(effective).toBeLessThan(70);
    expect(effective).toBeCloseTo(70 * 0.725, 1);
  });

  it("never mutates the stored score for a candidate with no known post time", () => {
    expect(effectiveScoreForSelection(55, null, NOW)).toBe(55);
  });
});

describe("isEligibleForDailySelection", () => {
  it("is eligible for a fresh post", () => {
    expect(isEligibleForDailySelection(hoursAgo(1), NOW)).toBe(true);
  });

  it("is eligible for a 24h-old post", () => {
    expect(isEligibleForDailySelection(hoursAgo(24), NOW)).toBe(true);
  });

  it("is eligible for a 48h-old post", () => {
    expect(isEligibleForDailySelection(hoursAgo(48), NOW)).toBe(true);
  });

  it("is still eligible at exactly the 72h boundary -- 'older than 72 hours' means strictly greater, not equal", () => {
    const atCutoff = new Date(NOW.getTime() - MAX_AGE_FOR_DAILY_SELECTION_MS).toISOString();
    expect(isEligibleForDailySelection(atCutoff, NOW)).toBe(true);
  });

  it("is NOT eligible one minute past the 72h boundary", () => {
    const justPastCutoff = new Date(NOW.getTime() - MAX_AGE_FOR_DAILY_SELECTION_MS - 60_000).toISOString();
    expect(isEligibleForDailySelection(justPastCutoff, NOW)).toBe(false);
  });

  it("is not eligible for a post several days old", () => {
    expect(isEligibleForDailySelection(hoursAgo(24 * 5), NOW)).toBe(false);
  });

  it("is eligible when postCreatedAt is unknown -- never excludes on missing data", () => {
    expect(isEligibleForDailySelection(null, NOW)).toBe(true);
  });
});
