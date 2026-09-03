import { describe, it, expect } from "vitest";
import { DAILY_SET_MAX, MIN_DAILY_SET_SCORE, selectDailyWorkingSet } from "../src/prospecting/prospectingDailySelection";
import type { ProspectingCandidate } from "../src/prospecting/types";

function candidate(overrides: Partial<ProspectingCandidate> & Pick<ProspectingCandidate, "id" | "opportunityScore">): ProspectingCandidate {
  return {
    platform: "x",
    externalId: overrides.id,
    discoveryQuery: "drawdown",
    authorHandle: `handle-${overrides.id}`,
    authorExternalId: `author-${overrides.id}`,
    authorName: null,
    authorFollowerCount: null,
    authorVerified: null,
    postText: "some post",
    postUrl: "https://x.com/i/web/status/1",
    postCreatedAt: null,
    publicMetrics: {},
    scoreBreakdown: {},
    creatorCandidate: false,
    status: "new",
    shownAt: null,
    openedAt: null,
    draftReply: null,
    finalReply: null,
    replyMentionsFillbook: null,
    replyUsedLink: null,
    repliedAt: null,
    skipReason: null,
    discoveredAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("selectDailyWorkingSet", () => {
  it("never fills the set with candidates below MIN_DAILY_SET_SCORE, even if that means fewer than DAILY_SET_MIN", () => {
    const pool = [candidate({ id: "1", opportunityScore: 30 }), candidate({ id: "2", opportunityScore: 25 })];
    const result = selectDailyWorkingSet(pool);
    expect(result.selected).toHaveLength(0);
    expect(result.belowQualityBar).toHaveLength(2);
  });

  it("selects at most DAILY_SET_MAX, deferring the rest as real backlog (not discarded)", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      candidate({ id: `${i}`, opportunityScore: MIN_DAILY_SET_SCORE + 10, authorExternalId: `author-${i}` }),
    );
    const result = selectDailyWorkingSet(pool);
    expect(result.selected).toHaveLength(DAILY_SET_MAX);
    expect(result.deferred).toHaveLength(20 - DAILY_SET_MAX);
  });

  it("shows fewer than DAILY_SET_MAX when fewer genuinely qualify -- never force-fills with weak posts", () => {
    const pool = [
      candidate({ id: "1", opportunityScore: 60 }),
      candidate({ id: "2", opportunityScore: 55 }),
      candidate({ id: "3", opportunityScore: 20 }), // below bar
    ];
    const result = selectDailyWorkingSet(pool);
    expect(result.selected).toHaveLength(2);
  });

  it("picks at most one candidate per author per day, keeping that author's highest-scored post", () => {
    const pool = [
      candidate({ id: "1", opportunityScore: 60, authorExternalId: "same-author" }),
      candidate({ id: "2", opportunityScore: 65, authorExternalId: "same-author" }),
      candidate({ id: "3", opportunityScore: 50, authorExternalId: "other-author" }),
    ];
    const result = selectDailyWorkingSet(pool);
    const sameAuthorPicks = result.selected.filter((c) => c.authorExternalId === "same-author");
    expect(sameAuthorPicks).toHaveLength(1);
    expect(sameAuthorPicks[0]!.id).toBe("2"); // the higher-scored of the two
    expect(result.deferred.map((c) => c.id)).toContain("1");
  });

  it("falls back to authorHandle, then id, when authorExternalId is null -- never treats two different unknown authors as the same person", () => {
    const pool = [
      candidate({ id: "1", opportunityScore: 60, authorExternalId: null, authorHandle: null }),
      candidate({ id: "2", opportunityScore: 55, authorExternalId: null, authorHandle: null }),
    ];
    const result = selectDailyWorkingSet(pool);
    expect(result.selected).toHaveLength(2);
  });

  it("breaks score ties by more recent discovery first", () => {
    const pool = [
      candidate({ id: "old", opportunityScore: 50, discoveredAt: "2026-09-01T00:00:00Z", authorExternalId: "a" }),
      candidate({ id: "new", opportunityScore: 50, discoveredAt: "2026-09-02T00:00:00Z", authorExternalId: "b" }),
    ];
    const result = selectDailyWorkingSet(pool);
    expect(result.selected[0]!.id).toBe("new");
  });

  it("returns an empty selection for an empty pool without erroring", () => {
    const result = selectDailyWorkingSet([]);
    expect(result).toEqual({ selected: [], deferred: [], belowQualityBar: [] });
  });
});
