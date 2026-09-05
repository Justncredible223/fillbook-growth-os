import { describe, it, expect } from "vitest";
import { scoreCandidate, rankCandidates, isQualifyingRecommendation, hasSufficientEvidenceForPitch, hasConcretePartnershipBasis, type DiscoveryCandidate } from "../src/partnerships/discoveryScoring";

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
    rawExcerpts: ["Just wrapped week 3 of our journaling cohort for funded traders -- risk management habits are finally sticking for half the group."],
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

  it("whyThisPartner quotes the candidate's own real words when excerpts exist, not just meta-commentary about the discovery process", () => {
    const rec = scoreCandidate(candidate({ rawExcerpts: ["We help funded traders build a real journaling habit before their next eval."] }), NOW);
    expect(rec.whyThisPartner).toContain("We help funded traders build a real journaling habit");
  });

  it("marks a candidate insufficient for pitching when it has no real quotable excerpts, even if it otherwise qualifies", () => {
    const rec = scoreCandidate(candidate({ rawExcerpts: [] }), NOW);
    expect(rec.sufficientForPitch).toBe(false);
    expect(rec.evidenceGap).toBeTruthy();
    expect(isQualifyingRecommendation(rec)).toBe(true); // still qualifies to be SURFACED -- just not presented as pitch-ready
  });

  it("marks a candidate insufficient when its only excerpt is too short to personalize anything", () => {
    const rec = scoreCandidate(candidate({ rawExcerpts: ["prop firm"] }), NOW);
    expect(rec.sufficientForPitch).toBe(false);
  });

  it("marks a candidate sufficient once it has a real excerpt over the minimum length", () => {
    expect(hasSufficientEvidenceForPitch({ ...candidate(), rawExcerpts: ["A real sentence about their actual trading education work and audience."] })).toBe(true);
  });
});

describe("hasConcretePartnershipBasis", () => {
  it("passes a solo independent creator/newsletter writer -- individuals are NOT excluded just for being individuals", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["Every week I break down a real trading psychology mistake for my newsletter subscribers -- this week's was revenge trading after a stop-out."] })).toBe(true);
  });

  it("passes a solo educator describing their own teaching work", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["I teach futures traders how to build a real risk-management routine, one small habit at a time."] })).toBe(true);
  });

  it("passes a community/cohort owner", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["Our community just hit 500 members -- all funded futures traders sharing real trade reviews."] })).toBe(true);
  });

  it("fails a retail customer's review/experience of a product they don't run", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["My experience with this prop firm has been great so far, the payouts are fast and the rules are clear."] })).toBe(false);
  });

  it("fails bystander commentary that merely discusses a topic", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["The whole prop firm industry is a mess right now, so many firms changing their rules overnight."] })).toBe(false);
  });

  it("fails empty evidence", () => {
    expect(hasConcretePartnershipBasis({ rawExcerpts: [] })).toBe(false);
  });

  it("having a contact channel alone is not evidence of a partnership basis -- this function only ever looks at excerpt text, never contactability", () => {
    // Structural guarantee: the function's own signature takes only
    // rawExcerpts, so a handle/website can never factor in here even by
    // accident -- confirms "merely having a contact channel is
    // insufficient" is enforced by construction, not just by convention.
    expect(hasConcretePartnershipBasis({ rawExcerpts: ["ok"] })).toBe(false);
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

  it("excludes a candidate with real posts but ZERO matched keywords, even with high recency/category/contactability -- regression test for a real production find (a crypto-yield-farming spam account scored 59 and qualified before this gate existed)", () => {
    const rec = scoreCandidate(candidate({ postsMatched: 2, matchedTopics: [], mostRecentMatchAt: NOW.toISOString(), partnerCategory: "creator_community" }), NOW);
    expect(rec.score).toBeGreaterThanOrEqual(40); // the score alone would have qualified -- confirms the gate, not the score, is what's protecting against this
    expect(isQualifyingRecommendation(rec)).toBe(false);
  });

  it("FINDING (stored real production evidence, not a fresh live discovery run): a real prospect currently sitting in 'qualified' still qualifies today, and its evidence is genuinely about the RECIPIENT's own work, not just a keyword hit -- Dan Cheung (a real discovered_via='creators' row, retrieved 2026-09-05 via a read-only production query, org name and excerpt text unmodified from the stored row)", () => {
    // This candidate's stored evidence: "Trading-journal/risk-management
    // educator. Journaling / journal-review discussions -- directly the
    // product's core format." -- genuinely describes the recipient's own
    // work, not a bystander's unrelated post that happens to contain a
    // matched keyword (see the next test for that failure mode).
    const rec = scoreCandidate(
      candidate({
        organizationName: "Dan Cheung",
        partnerCategory: "educator_coach",
        handle: "wannabechamp",
        matchedTopics: ["journaling"],
        postsMatched: 1,
        discoveredVia: "creators",
        rawExcerpts: ["Trading-journal/risk-management educator. Journaling / journal-review discussions -- directly the product's core format."],
      }),
      NOW,
    );
    expect(isQualifyingRecommendation(rec)).toBe(true);
    expect(rec.sufficientForPitch).toBe(true);
    expect(hasConcretePartnershipBasis(rec.candidate)).toBe(true); // "educator" -- real evidence they run an educational offering
  });

  it("FIXED (was an open gap, now closed): a candidate whose ONLY evidence is an individual retail trader's post ABOUT a prop firm they use -- not themselves a business, coach, or community Fillbook could realistically pitch a partnership to -- no longer has a concrete partnership basis, even though it still clears every OTHER existing check. 'pijat jogja', a real x_search-discovered row retrieved 2026-09-05 via a read-only production query (org name and excerpt text unmodified), whose entire stored evidence is one trader's satisfied-customer review of 'Trusteed Prop Firm'. isQualifyingRecommendation's existing matchedTopics/score/contactability/postsMatched gate (added for a prior crypto-spam finding, see the test above) never caught this different failure mode -- real topical evidence from a real, recent, contactable account that is nonetheless the WRONG KIND of account. hasConcretePartnershipBasis is the new, separate gate that catches it: it governs whether discovery.ts auto-QUALIFIES a candidate (and whether generateDraftForPartnership will draft for it), NOT whether it's surfaced at all -- isQualifyingRecommendation itself is deliberately unchanged.", () => {
    const rec = scoreCandidate(
      candidate({
        organizationName: "pijat jogja",
        partnerCategory: "prop_firm",
        handle: "pijatjogja19cem",
        matchedTopics: ["prop firm"],
        postsMatched: 1,
        discoveredVia: "x_search",
        rawExcerpts: [
          "Honestly, my experience with Trusteed Prop Firm, especially the Constant Funded program, has been really positive so far. The rules are clear, the process is straightforward, and everything feels transparent.\n\nAs a trader, I value more than just the opportunity to make profits.",
        ],
      }),
      NOW,
    );
    expect(isQualifyingRecommendation(rec)).toBe(true); // still surfaced, as a plain 'prospect' for manual research -- see discovery.ts
    expect(rec.sufficientForPitch).toBe(true); // has enough CHARACTERS to look pitch-ready
    expect(hasConcretePartnershipBasis(rec.candidate)).toBe(false); // but is NOT the right kind of recipient -- this is what now blocks auto-qualification and drafting
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
