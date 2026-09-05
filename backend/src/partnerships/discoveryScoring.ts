import type { PartnerCategory } from "./types.js";

/**
 * Real, unverified evidence gathered about one candidate before any
 * scoring happens -- every field here must trace back to something
 * actually observed (a real post, a real creators-table row, a real
 * bio), never invented. See discovery.ts's own doc comment for where
 * each `discoveredVia` source populates this from.
 */
export interface DiscoveryCandidate {
  organizationName: string;
  contactName: string | null;
  partnerCategory: PartnerCategory;
  /** Lowercased, no leading "@" -- null if no handle was found (see discovery.ts's contactability requirement). */
  handle: string | null;
  websiteUrl: string | null;
  /** Which topic keywords (from DISCOVERY_TOPIC_KEYWORDS below) were actually found in this candidate's own bio/post text -- never inferred beyond literal matches. */
  matchedTopics: string[];
  /** How many distinct on-topic posts/mentions this candidate has, across however many were actually found -- not a lifetime total, just what discovery actually read. */
  postsMatched: number;
  /** ISO date of the most recent matched activity, if known. */
  mostRecentMatchAt: string | null;
  sourceUrls: string[];
  discoveredVia: "creators" | "prospecting" | "inbound" | "x_search";
  /**
   * The ACTUAL text discovery read (real post bodies, creator notes) --
   * not a description of the discovery process. This is the only
   * material the pitch writer and reviewers can use to personalize a
   * pitch to this specific recipient; without it, a pitch can only ever
   * be generic. Populated by discovery.ts, optionally supplemented by
   * discoverFromXSearch's own per-handle enrichment lookup when this
   * would otherwise be too thin. Never fabricated -- empty if nothing
   * real was found.
   */
  rawExcerpts: string[];
}

export type DiscoveryConfidence = "low" | "medium" | "high";

export interface RankedRecommendation {
  candidate: DiscoveryCandidate;
  /** 0-100 -- a fit/evidence score, explicitly NOT a conversion probability and NOT a proxy for follower count (neither factors in). */
  score: number;
  confidence: DiscoveryConfidence;
  whyThisPartner: string;
  suggestedCollaboration: string;
  scoreBreakdown: {
    audienceFit: number;
    evidenceOfActivity: number;
    complementaryValue: number;
    contactability: number;
  };
  /**
   * True only when candidate.rawExcerpts carries enough real text to
   * actually personalize a pitch (see MIN_PERSONALIZATION_CHARS). A
   * candidate can qualify (score/topics/contactability all clear) while
   * still being false here -- that's exactly the case that must NOT be
   * presented as "ready to pursue": there's a real match, but not enough
   * of the recipient's own words yet to write anything but a generic
   * pitch, which the review gate correctly rejects every time.
   */
  sufficientForPitch: boolean;
  /** Set only when sufficientForPitch is false -- what's actually missing, shown to the owner instead of a false "ready" presentation. */
  evidenceGap: string | null;
}

/**
 * Keyword groups used to detect topic relevance in whatever real text
 * (bio, post body) discovery actually collected. Deliberately literal
 * substring matching, not an LLM classification -- keeps discovery's own
 * cost at $0 beyond the X search reads themselves (see discovery.ts),
 * and keeps "why this partner" traceable to an exact matched phrase
 * rather than a model's paraphrase.
 */
export const DISCOVERY_TOPIC_KEYWORDS: Record<string, string[]> = {
  educator_coach: ["trading coach", "trading educator", "trading mentor", "futures education", "trading psychology coach", "journaling"],
  creator_community: ["trading community", "trader discord", "trading group", "futures traders"],
  prop_firm: ["prop firm", "funded account", "funded trader", "proprietary trading firm"],
  platform_broker: ["trading platform", "futures broker", "brokerage"],
};

/**
 * Fixed priority weight matching docs/PARTNERSHIPS_MISSION.md's own
 * stated priority order (educators/coaches first, then creators/
 * communities, then prop firms, then platforms/brokers) -- NOT a stand-in
 * for follower count or estimated reach, which never factor into this
 * score anywhere.
 */
const CATEGORY_PRIORITY_WEIGHT: Record<PartnerCategory, number> = {
  educator_coach: 1.0,
  creator_community: 0.85,
  prop_firm: 0.7,
  platform_broker: 0.6,
  other: 0.5,
};

/** Real, mission-approved offer per category (docs/PARTNERSHIPS_MISSION.md Phase 4's "Offer types" list) -- a genuine proposal to discuss, never a commercial term presented as agreed. */
const SUGGESTED_COLLABORATION: Record<PartnerCategory, string> = {
  educator_coach: "A guided journaling pilot for a small cohort of their traders.",
  creator_community: "A live Fillbook demonstration for their community/audience.",
  prop_firm: "A member-access or integration discussion for their funded traders.",
  platform_broker: "A referral partnership discussion.",
  other: "An educational session or product walkthrough.",
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * A pitch writer needs real, quotable material to say something a
 * generic template couldn't -- one short keyword match ("prop firm")
 * with no actual sentence around it isn't enough, and a real production
 * run confirmed this exact gap (5 of 9 reviewers rejected a pitch for
 * demonstrating "zero evidence the sender knows anything about" the
 * recipient, even though the candidate had technically "qualified").
 * Deliberately modest (30 chars is roughly one short sentence fragment,
 * not a real bar for good writing) -- this is a floor against total
 * emptiness, not a quality guarantee; the review gate still judges the
 * actual pitch.
 */
export const MIN_PERSONALIZATION_CHARS = 30;

/**
 * Takes just the excerpts (not the full DiscoveryCandidate) so callers
 * outside discovery -- generateDraftForPartnership checking a prospect
 * that may have been created manually, not just discovered -- can use
 * the exact same real bar without an awkward partial-object cast.
 */
export function hasSufficientEvidenceForPitch(candidate: { rawExcerpts: string[] }): boolean {
  return candidate.rawExcerpts.join(" ").trim().length >= MIN_PERSONALIZATION_CHARS;
}

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / (1000 * 60 * 60 * 24);
}

/**
 * Pure scoring -- no network/DB access, fully unit-testable. Every input
 * is real evidence discovery.ts actually gathered; this function only
 * combines it into an explainable score, it never adds new claims.
 */
export function scoreCandidate(candidate: DiscoveryCandidate, now: Date = new Date()): RankedRecommendation {
  const audienceFit = clamp01(candidate.matchedTopics.length / 3);

  const recencyDays = daysSince(candidate.mostRecentMatchAt, now);
  const recencyScore = recencyDays === null ? 0 : recencyDays <= 30 ? 1 : recencyDays <= 90 ? 0.6 : recencyDays <= 180 ? 0.3 : 0.1;
  const volumeScore = clamp01(candidate.postsMatched / 3);
  const evidenceOfActivity = clamp01(recencyScore * 0.6 + volumeScore * 0.4);

  const complementaryValue = CATEGORY_PRIORITY_WEIGHT[candidate.partnerCategory];

  const contactability = candidate.handle || candidate.websiteUrl ? 1 : 0;

  const score = Math.round(100 * (audienceFit * 0.35 + evidenceOfActivity * 0.25 + complementaryValue * 0.2 + contactability * 0.2));

  const confidence: DiscoveryConfidence =
    candidate.postsMatched >= 2 && audienceFit >= 0.6 && evidenceOfActivity >= 0.5
      ? "high"
      : candidate.postsMatched >= 1 && score >= 50
        ? "medium"
        : "low";

  const evidenceLine =
    candidate.postsMatched > 0
      ? `${candidate.postsMatched} on-topic post${candidate.postsMatched === 1 ? "" : "s"} found (topics: ${candidate.matchedTopics.join(", ") || "none matched"}), most recent ${candidate.mostRecentMatchAt ?? "unknown date"}.`
      : `No on-topic posts found yet -- listed from existing records only (topics: ${candidate.matchedTopics.join(", ") || "none matched"}).`;

  const sufficientForPitch = hasSufficientEvidenceForPitch(candidate);
  // The longest excerpt is the most useful one to quote (and, when
  // enrichment added a real post after an initial thin keyword-only
  // match, it's also the substantive one -- the original thin match
  // stays first in the array, so picking by length rather than index 0
  // matters here).
  const bestExcerpt = [...candidate.rawExcerpts].sort((a, b) => b.length - a.length)[0];
  const excerptLine = bestExcerpt ? ` Their own words: "${bestExcerpt.slice(0, 240)}"` : "";

  const whyThisPartner = `Discovered via ${candidate.discoveredVia.replace("_", " ")}. ${evidenceLine}${excerptLine}`;

  const evidenceGap = sufficientForPitch
    ? null
    : "Not enough of this recipient's own words were found to personalize a pitch confidently yet -- only a keyword/category match, no real quotable content. Needs manual research (their actual posts, site, or a direct look at their profile) before drafting.";

  return {
    candidate,
    score,
    confidence,
    whyThisPartner,
    suggestedCollaboration: SUGGESTED_COLLABORATION[candidate.partnerCategory],
    scoreBreakdown: { audienceFit, evidenceOfActivity, complementaryValue, contactability },
    sufficientForPitch,
    evidenceGap,
  };
}

/**
 * A candidate is surfaceable at all only if it's actually contactable
 * (has a real handle or website -- otherwise there's no "open the
 * verified contact channel" step to offer) and has at least some real
 * evidence behind it (never a bare name with nothing to qualify it).
 * MIN_SCORE is deliberately modest (this is a brand-new pipeline over a
 * sparse initial dataset) but never zero -- a hard floor still exists.
 */
const MIN_SCORE = 40;

export function isQualifyingRecommendation(rec: RankedRecommendation): boolean {
  // matchedTopics.length > 0 is load-bearing, not redundant with
  // postsMatched >= 1: a candidate found via an X search query still
  // carries that query's OWN category label even when the candidate's
  // actual text matched none of DISCOVERY_TOPIC_KEYWORDS (X's full-text
  // relevance is looser than this project's own keyword check) -- without
  // this, a real production run surfaced a crypto-yield-farming spam
  // account with "topics: none matched" purely on recency+category+
  // contactability. Zero real keyword evidence must never qualify,
  // regardless of how many posts were merely returned by the search.
  return (
    rec.scoreBreakdown.contactability > 0 &&
    rec.candidate.postsMatched >= 1 &&
    rec.candidate.matchedTopics.length > 0 &&
    rec.score >= MIN_SCORE
  );
}

/** Ranks and filters to only qualifying recommendations, highest score first. */
export function rankCandidates(candidates: DiscoveryCandidate[], now: Date = new Date()): RankedRecommendation[] {
  return candidates
    .map((c) => scoreCandidate(c, now))
    .filter(isQualifyingRecommendation)
    .sort((a, b) => b.score - a.score);
}
