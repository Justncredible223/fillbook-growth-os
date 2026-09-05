import { describe, it, expect } from "vitest";
import { scoreCandidate, rankCandidates, isQualifyingRecommendation, type DiscoveryCandidate } from "../src/partnerships/discoveryScoring";

const NOW = new Date("2026-09-05T00:00:00Z");

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    organizationName: "Apex Journaling Coach",
    contactName: "Dana",
    partnerCategory: "educator_coach",
    handle: "apexcoach",
    websiteUrl: null,
    matchedTopics: ["trading coach", "journaling"],
    postsMatched: 3,
    mostRecentMatchAt: "2026-09-01T00:00:00Z",
    sourceUrls: ["https://x.com/apexcoach/status/1"],
    discoveredVia: "x_search",
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("scores a well-evidenced, contactable, high-priority-category candidate as high confidence", () => {
    const rec = scoreCandidate(candidate(), NOW);
    expect(rec.confidence).toBe("high");
    expect(rec.score).toBeGreaterThan(60);
    expect(rec.scoreBreakdown.contactability).toBe(1);
  });

  it("never lets follower count or reach factor in -- DiscoveryCandidate has no such field at all, so this is structurally guaranteed, not just behaviorally", () => {
    // @ts-expect-error -- followerCount must not exist on DiscoveryCandidate; if this ever compiles, someone added a reach field back in.
    const withFollowers: DiscoveryCandidate = { ...candidate(), followerCount: 999999 };
    void withFollowers;
  });

  it("scores an uncontactable candidate (no handle, no website) with contactability 0", () => {
    const rec = scoreCandidate(candidate({ handle: null, websiteUrl: null }), NOW);
    expect(rec.scoreBreakdown.contactability).toBe(0);
  });

  it("scores stale evidence (>180 days old) lower than fresh evidence, all else equal", () => {
    const fresh = scoreCandidate(candidate({ mostRecentMatchAt: "2026-09-01T00:00:00Z" }), NOW);
    const stale = scoreCandidate(candidate({ mostRecentMatchAt: "2025-01-01T00:00:00Z" }), NOW);
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it("gives low confidence to a candidate with only one matched post and a low score", () => {
    const rec = scoreCandidate(candidate({ postsMatched: 1, matchedTopics: [], mostRecentMatchAt: null }), NOW);
    expect(rec.confidence).toBe("low");
  });

  it("assigns a real, mission-approved suggested collaboration per category, never a fabricated commercial term", () => {
    const educator = scoreCandidate(candidate({ partnerCategory: "educator_coach" }), NOW);
    const propFirm = scoreCandidate(candidate({ partnerCategory: "prop_firm" }), NOW);
    expect(educator.suggestedCollaboration).toContain("pilot");
    expect(propFirm.suggestedCollaboration).toContain("integration");
    expect(educator.suggestedCollaboration).not.toMatch(/commission|% |free forever|exclusive/i);
  });

  it("weights category priority in mission order: educator_coach > creator_community > prop_firm > platform_broker", () => {
    const educator = scoreCandidate(candidate({ partnerCategory: "educator_coach" }), NOW);
    const creator = scoreCandidate(candidate({ partnerCategory: "creator_community" }), NOW);
    const propFirm = scoreCandidate(candidate({ partnerCategory: "prop_firm" }), NOW);
    const platform = scoreCandidate(candidate({ partnerCategory: "platform_broker" }), NOW);
    expect(educator.scoreBreakdown.complementaryValue).toBeGreaterThan(creator.scoreBreakdown.complementaryValue);
    expect(creator.scoreBreakdown.complementaryValue).toBeGreaterThan(propFirm.scoreBreakdown.complementaryValue);
    expect(propFirm.scoreBreakdown.complementaryValue).toBeGreaterThan(platform.scoreBreakdown.complementaryValue);
  });

  it("whyThisPartner cites the actual evidence gathered (topics, count, source), not a generic template with no numbers", () => {
    const rec = scoreCandidate(candidate({ postsMatched: 4, matchedTopics: ["trading coach"] }), NOW);
    expect(rec.whyThisPartner).toContain("4");
    expect(rec.whyThisPartner).toContain("trading coach");
    expect(rec.whyThisPartner).toContain("x search");
  });
});

describe("isQualifyingRecommendation / rankCandidates", () => {
  it("excludes an uncontactable candidate even if its score would otherwise qualify", () => {
    const rec = scoreCandidate(candidate({ handle: null, websiteUrl: null, postsMatched: 5, matchedTopics: ["trading coach", "journaling", "trading mentor"] }), NOW);
    expect(isQualifyingRecommendation(rec)).toBe(false);
  });

  it("excludes a candidate with zero matched posts (existing-record listing with no real evidence)", () => {
    const rec = scoreCandidate(candidate({ postsMatched: 0 }), NOW);
    expect(isQualifyingRecommendation(rec)).toBe(false);
  });

  it("ranks qualifying candidates highest-score-first and drops non-qualifying ones", () => {
    const strong = candidate({ organizationName: "Strong", postsMatched: 4, matchedTopics: ["trading coach", "journaling", "trading mentor"] });
    const weak = candidate({ organizationName: "Weak", postsMatched: 1, matchedTopics: [] });
    const uncontactable = candidate({ organizationName: "Uncontactable", handle: null, websiteUrl: null });
    const ranked = rankCandidates([weak, strong, uncontactable], NOW);
    expect(ranked.map((r) => r.candidate.organizationName)).not.toContain("Uncontactable");
    if (ranked.length > 1) {
      expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    }
    expect(ranked[0]!.candidate.organizationName).toBe("Strong");
  });
});
