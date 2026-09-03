import { describe, it, expect } from "vitest";
import { scoreProspectingCandidate } from "../src/prospecting/prospectingScoring";
import type { ProspectingTopic } from "../src/prospecting/prospectingTopics";

const topic: ProspectingTopic = { key: "trading_journal", query: '"trading journal"', label: "Trading journal", relevantFeature: "journaling" };
const now = new Date("2026-09-01T12:00:00Z");

function baseInput(overrides: Partial<Parameters<typeof scoreProspectingCandidate>[0]> = {}) {
  return {
    topic,
    postText: "How do you actually review your trades at the end of the week?",
    postCreatedAt: now,
    publicMetrics: { reply_count: 1, quote_count: 0, like_count: 3 },
    authorFollowerCount: 500,
    authorVerified: false,
    previouslyEngaged: false,
    now,
    ...overrides,
  };
}

describe("scoreProspectingCandidate", () => {
  it("excludes obvious spam/signal-selling posts outright, not just down-ranks them", () => {
    const result = scoreProspectingCandidate(baseInput({ postText: "DM me for signals, 100% win rate guaranteed!!!" }));
    expect(result.excluded).toBe(true);
    expect(result.score).toBe(0);
    expect(result.exclusionReason).toMatch(/spam/i);
  });

  it("does not let a large follower count dominate the score", () => {
    const smallButRelevant = scoreProspectingCandidate(
      baseInput({ authorFollowerCount: 200, publicMetrics: { reply_count: 10, quote_count: 2, like_count: 40 } }),
    );
    const bigButQuiet = scoreProspectingCandidate(
      baseInput({ authorFollowerCount: 500_000, publicMetrics: { reply_count: 0, quote_count: 0, like_count: 0 } }),
    );
    expect(smallButRelevant.score).toBeGreaterThan(bigButQuiet.score);
  });

  it("caps author-reach points regardless of how large the follower count is", () => {
    const huge = scoreProspectingCandidate(baseInput({ authorFollowerCount: 50_000_000 }));
    const large = scoreProspectingCandidate(baseInput({ authorFollowerCount: 1_000_000 }));
    // Reach is log-scaled and capped -- a 50x larger following shouldn't move the score much.
    expect(huge.score - large.score).toBeLessThan(5);
  });

  it("scores a post asking a real question higher than a same-topic post with no question and little context", () => {
    const withQuestion = scoreProspectingCandidate(baseInput({ postText: "How do you actually review your trades at the end of the week?" }));
    const withoutQuestion = scoreProspectingCandidate(baseInput({ postText: "journal" }));
    expect(withQuestion.score).toBeGreaterThan(withoutQuestion.score);
  });

  it("gives a bonus for a previously-engaged author, but it alone cannot flip exclusion", () => {
    const engaged = scoreProspectingCandidate(baseInput({ previouslyEngaged: true }));
    const notEngaged = scoreProspectingCandidate(baseInput({ previouslyEngaged: false }));
    expect(engaged.score).toBeGreaterThan(notEngaged.score);

    const stillSpam = scoreProspectingCandidate(baseInput({ previouslyEngaged: true, postText: "click the link in my bio for free signals" }));
    expect(stillSpam.excluded).toBe(true);
  });

  it("never returns a score outside 0-100", () => {
    const result = scoreProspectingCandidate(
      baseInput({ authorFollowerCount: 10_000_000, authorVerified: true, publicMetrics: { reply_count: 100_000, quote_count: 50_000, like_count: 1_000_000 } }),
    );
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("includes a human-readable breakdown for every scored (non-excluded) candidate", () => {
    const result = scoreProspectingCandidate(baseInput());
    expect(result.excluded).toBe(false);
    expect(Object.keys(result.breakdown)).toEqual(
      expect.arrayContaining(["topicRelevance", "activeDiscussion", "authorReach", "recency", "authenticity", "valueOpportunity", "priorRelationship"]),
    );
  });
});
