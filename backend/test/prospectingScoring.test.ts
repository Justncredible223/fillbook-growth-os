import { describe, it, expect } from "vitest";
import { scoreProspectingCandidate } from "../src/prospecting/prospectingScoring";
import { MIN_DAILY_SET_SCORE } from "../src/prospecting/prospectingDailySelection";
import type { ProspectingTopic } from "../src/prospecting/prospectingTopics";

const topic: ProspectingTopic = { key: "trading_journal", query: '"trading journal"', label: "Trading journal", replyClass: "A" };
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
  it("excludes hashtag-stuffed/listicle-formatted posts (found live: a bot account scored 65+ before this check)", () => {
    const result = scoreProspectingCandidate(
      baseInput({
        postText: "What's your best pair?\n\n.\n.\n.\n.\n\nforex trading tips\nforex trading psychology\nforex risk management\nforex market structure",
      }),
    );
    expect(result.excluded).toBe(true);
  });

  it("excludes prop-firm discount-ad formatting (found live: scored 59+ before this check)", () => {
    const result = scoreProspectingCandidate(
      baseInput({
        postText: "Get a 1 Step $100K Nano Account for only $240:\n\n💰 10% Profit Target\n📉 4% Max Daily Loss\n🛡️ No time limit",
      }),
    );
    expect(result.excluded).toBe(true);
  });

  it("does NOT exclude a real conversational multi-line post (periods/questions, not short tag fragments)", () => {
    const result = scoreProspectingCandidate(
      baseInput({
        postText:
          "Two trading bots. Same strategy, same signals, the same 60% win rate. One runs 3x leverage. The other runs none. A year later, the results tell a very different story.",
      }),
    );
    expect(result.excluded).toBe(false);
  });

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

  it("REFINED (2026-09-07 freshness/audience-quality review): a very-low-follower account is not hard-excluded -- a genuinely relevant, engaged post from a near-zero-follower account can still clear MIN_DAILY_SET_SCORE", () => {
    const tinyAccount = scoreProspectingCandidate(
      baseInput({
        authorFollowerCount: 3,
        publicMetrics: { reply_count: 8, quote_count: 1, like_count: 20 },
        postText: "How do you actually decide when to cut a losing trade instead of hoping it comes back?",
      }),
    );
    expect(tinyAccount.excluded).toBe(false);
    expect(tinyAccount.score).toBeGreaterThanOrEqual(MIN_DAILY_SET_SCORE);
  });

  it("follower count still moves the score (soft signal), just not by much -- confirms it influences ranking without dominating or excluding", () => {
    const zeroFollowers = scoreProspectingCandidate(baseInput({ authorFollowerCount: 0 }));
    const hundredKFollowers = scoreProspectingCandidate(baseInput({ authorFollowerCount: 100_000 }));
    expect(hundredKFollowers.score).toBeGreaterThan(zeroFollowers.score); // it does influence ranking...
    expect(hundredKFollowers.score - zeroFollowers.score).toBeLessThanOrEqual(15); // ...but only ever by the capped reach-points range, never dominant
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
