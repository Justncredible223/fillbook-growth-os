import { describe, it, expect } from "vitest";
import { isFollowUpDue, shouldStopFollowUps, MAX_FOLLOW_UP_DRAFTS, FOLLOW_UP_INTERVAL_DAYS } from "../src/partnerships/followUps";

const NOW = new Date("2026-09-20T00:00:00Z");

function prospect(overrides: Partial<{ stage: any; contactedAt: string | null; followUpCount: number }> = {}) {
  return { stage: "contacted", contactedAt: "2026-09-01T00:00:00Z", followUpCount: 0, ...overrides };
}

describe("shouldStopFollowUps", () => {
  it("stops on replied, do_not_contact, closed, archived, pilot, active_partner", () => {
    for (const stage of ["replied", "do_not_contact", "closed", "archived", "pilot", "active_partner"] as const) {
      expect(shouldStopFollowUps({ stage })).toBe(true);
    }
  });
  it("does not stop while still in prospect/qualified/draft_ready/contacted", () => {
    for (const stage of ["prospect", "qualified", "draft_ready", "contacted"] as const) {
      expect(shouldStopFollowUps({ stage })).toBe(false);
    }
  });
});

describe("isFollowUpDue -- timing starts from actual contact, not draft creation", () => {
  it("is due once FOLLOW_UP_INTERVAL_DAYS have passed since contactedAt, with no prior follow-up", () => {
    const contactedAt = new Date(NOW.getTime() - (FOLLOW_UP_INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(isFollowUpDue(prospect({ contactedAt }), null, NOW)).toBe(true);
  });

  it("is NOT due before the interval has elapsed since contactedAt", () => {
    const contactedAt = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFollowUpDue(prospect({ contactedAt }), null, NOW)).toBe(false);
  });

  it("uses the LAST follow-up's timestamp, not the original contact date, once one follow-up has already been sent", () => {
    const contactedLongAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentFollowUp = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFollowUpDue(prospect({ contactedAt: contactedLongAgo, followUpCount: 1 }), recentFollowUp, NOW)).toBe(false);
  });

  it("is never due once MAX_FOLLOW_UP_DRAFTS has already been sent", () => {
    const contactedAt = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFollowUpDue(prospect({ contactedAt, followUpCount: MAX_FOLLOW_UP_DRAFTS }), null, NOW)).toBe(false);
  });

  it("is never due once a stop condition applies, no matter how much time has passed", () => {
    const contactedAt = new Date(NOW.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(isFollowUpDue(prospect({ stage: "replied", contactedAt }), null, NOW)).toBe(false);
    expect(isFollowUpDue(prospect({ stage: "do_not_contact", contactedAt }), null, NOW)).toBe(false);
  });

  it("is never due for a prospect that was never actually contacted (draft generated but not sent)", () => {
    expect(isFollowUpDue(prospect({ stage: "draft_ready", contactedAt: null }), null, NOW)).toBe(false);
  });

  it("MAX_FOLLOW_UP_DRAFTS defaults to 2, per the mission's explicit bound", () => {
    expect(MAX_FOLLOW_UP_DRAFTS).toBe(2);
  });
});
