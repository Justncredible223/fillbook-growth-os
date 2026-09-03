import type { ProspectingTopic } from "./prospectingTopics.js";

// Real evidence this run's own results turned up (2026-09-03 live search):
// a competitor prop-firm discount ad and a hashtag-stuffed forex-bot account
// both scored high enough to reach the queue -- SPAM_PATTERNS below only
// caught explicit signal-selling phrasing, not promotional listicle/ad
// formatting. isListicleOrAdFormatted() below closes that gap.

export interface ProspectingScoreInput {
  topic: ProspectingTopic;
  postText: string;
  postCreatedAt: Date | null;
  publicMetrics: Record<string, number> | null;
  authorFollowerCount: number | null;
  authorVerified: boolean | null;
  /** From prospecting_outreach -- true if we've already replied to this author before via Prospecting. */
  previouslyEngaged: boolean;
  now: Date;
}

export interface ProspectingScoreResult {
  score: number; // 0-100
  breakdown: Record<string, string>;
  /** Hard-excluded candidates (spam patterns) never reach the queue at all -- not just low-scored. */
  excluded: boolean;
  exclusionReason: string | null;
}

// Class A (direct fit) weighted highest, Class C (relationship fit, no
// Fillbook mention required) lowest but still meaningfully scored -- a
// credible futures trader talking process/psychology is a real
// opportunity per the "REACH + RELATIONSHIPS + REPUTATION" operating goal,
// just a lower-priority one than a direct journaling/prop-firm-rules post.
const CLASS_WEIGHT: Record<ProspectingTopic["replyClass"], number> = {
  A: 20,
  B: 15,
  C: 10,
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Phrases that show up almost exclusively in signal-selling/spam/bot posts
// -- excluded outright rather than merely down-ranked, since a reply under
// one of these actively damages the "recognizable, useful account" goal
// from MASTER_SOCIAL_STRATEGY.md rather than just wasting a reply slot.
const SPAM_PATTERNS = [
  /dm (me|for) (signals|access|mentorship)/i,
  /guaranteed (profit|return)/i,
  /100% win rate/i,
  /click (the )?link in (my )?bio/i,
  /free (signals|mentorship|course)/i,
  /crypto airdrop/i,
  /\$\$\$+/,
  /follow.{0,15}back/i,
  /\d+%\s*(off|discount)/i,
  /(promo|discount) code/i,
  /trader-?friendly conditions/i,
  /\$\d+k?\s+(nano|micro)\s+account/i,
];

/**
 * Catches promotional/hashtag-listicle formatting that SPAM_PATTERNS'
 * phrase matching misses -- e.g. a prop-firm ad's "profit target / max
 * daily loss / ..." bullet list, or a bot account's repeated "forex
 * trading X" tag lines. Heuristic: 4+ short lines (<=40 chars) with no
 * terminal sentence punctuation is how X ad copy and hashtag-stuffing
 * both actually look, versus a real conversational multi-line post whose
 * lines end in periods/questions or run longer.
 */
function isListicleOrAdFormatted(text: string): boolean {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 4) return false;
  const shortUnpunctuatedLines = lines.filter((l) => l.length <= 40 && !/[.!?]$/.test(l));
  return shortUnpunctuatedLines.length >= 4;
}

/**
 * Pure scoring function -- multi-factor, deliberately NOT
 * follower-count-dominant per fillbookhq/docs/social/
 * MASTER_SOCIAL_STRATEGY.md ("Follower count alone does NOT determine
 * priority"). Author reach is capped at 15 of 100 possible points; topic
 * relevance, active discussion, and recency together can outweigh it, so
 * a smaller but highly relevant trader can still rank above a large but
 * generic account. No I/O, fully unit-testable.
 */
export function scoreProspectingCandidate(input: ProspectingScoreInput): ProspectingScoreResult {
  const spamMatch = SPAM_PATTERNS.find((pattern) => pattern.test(input.postText));
  if (spamMatch) {
    return {
      score: 0,
      breakdown: { spam: `matched spam pattern ${spamMatch.source} -> excluded` },
      excluded: true,
      exclusionReason: "Looks like signal-selling/spam, not a real trader conversation.",
    };
  }
  if (isListicleOrAdFormatted(input.postText)) {
    return {
      score: 0,
      breakdown: { spam: "hashtag-stuffed or ad-listicle formatting -> excluded" },
      excluded: true,
      exclusionReason: "Reads as promotional/hashtag-listicle formatting, not a real trader conversation.",
    };
  }

  const breakdown: Record<string, string> = {};

  // Topic/class relevance -- see CLASS_WEIGHT doc comment above.
  const topicPoints = CLASS_WEIGHT[input.topic.replyClass];
  breakdown.topicRelevance = `"${input.topic.label}" (Class ${input.topic.replyClass}) -> +${topicPoints}`;

  // Active discussion -- replies/quotes matter more than raw likes for
  // "other people are actively discussing this post."
  const metrics = input.publicMetrics ?? {};
  const replyCount = metrics.reply_count ?? 0;
  const quoteCount = metrics.quote_count ?? 0;
  const likeCount = metrics.like_count ?? 0;
  const discussionRaw = replyCount * 3 + quoteCount * 2 + likeCount * 0.5;
  const discussionPoints = Math.min(Math.log10(discussionRaw + 1) * 8, 20);
  breakdown.activeDiscussion = `${replyCount} replies, ${quoteCount} quotes, ${likeCount} likes -> +${discussionPoints.toFixed(1)}`;

  // Author reach -- capped, log-scaled, deliberately not dominant.
  const followers = input.authorFollowerCount ?? 0;
  const reachPoints = Math.min(Math.log10(followers + 1) * 3, 15);
  breakdown.authorReach = `${followers} followers -> +${reachPoints.toFixed(1)} (capped at 15)`;

  // Recency -- linear decay across the 7-day search window.
  let recencyPoints = 5;
  if (input.postCreatedAt) {
    const ageMs = input.now.getTime() - input.postCreatedAt.getTime();
    const fraction = Math.max(0, 1 - ageMs / SEVEN_DAYS_MS);
    recencyPoints = fraction * 15;
    breakdown.recency = `posted ${(ageMs / 3_600_000).toFixed(1)}h ago -> +${recencyPoints.toFixed(1)}`;
  } else {
    breakdown.recency = `unknown post time -> +${recencyPoints}`;
  }

  // Authenticity -- verified is a mild positive signal; nothing here can
  // ever prove "real person," only nudge toward it, per X visibility
  // discipline in MASTER_SOCIAL_STRATEGY.md (no unverifiable claims).
  const authenticityPoints = input.authorVerified ? 5 : 0;
  breakdown.authenticity = input.authorVerified ? "verified account -> +5" : "not verified -> +0";

  // Natural value-add opportunity -- a real question invites a real
  // answer; very short posts rarely have enough context for a useful reply.
  const hasQuestion = input.postText.includes("?");
  const longEnough = input.postText.trim().length >= 40;
  const opportunityPoints = (hasQuestion ? 8 : 0) + (longEnough ? 7 : 0);
  breakdown.valueOpportunity = `${hasQuestion ? "asks a question" : "no question"}, ${longEnough ? "enough context" : "too short for context"} -> +${opportunityPoints}`;

  // Existing relationship -- a natural second touch beats a cold first one.
  const relationshipPoints = input.previouslyEngaged ? 10 : 0;
  breakdown.priorRelationship = input.previouslyEngaged
    ? "already replied to this author before -> +10"
    : "no prior Prospecting contact -> +0";

  const total = topicPoints + discussionPoints + reachPoints + recencyPoints + authenticityPoints + opportunityPoints + relationshipPoints;
  const score = Math.round(Math.max(0, Math.min(100, total)) * 100) / 100;

  return { score, breakdown, excluded: false, exclusionReason: null };
}
