import { describe, it, expect } from "vitest";
import { enrichWithSourceUrls, singleSignalIds } from "../src/opportunities/opportunitySourceEnrichment";
import type { Opportunity } from "../src/opportunities/types";

function makeOpportunity(overrides: Partial<Opportunity>): Opportunity {
  return {
    id: "opp-1",
    title: "t",
    score: 50,
    urgency: "normal",
    confidence: 0.5,
    rationale: "r",
    recommendedChannels: [],
    recommendedCampaignType: null,
    approvalClass: "EXTERNAL_DRAFT",
    status: "open",
    signalIds: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe("singleSignalIds", () => {
  it("only includes opportunities with exactly one linked signal", () => {
    const opps = [
      makeOpportunity({ id: "a", signalIds: ["s1"] }),
      makeOpportunity({ id: "b", signalIds: ["s2", "s3"] }),
      makeOpportunity({ id: "c", signalIds: [] }),
    ];
    expect(singleSignalIds(opps)).toEqual(["s1"]);
  });
});

describe("enrichWithSourceUrls", () => {
  it("attaches sourceUrl for a single x_mention signal with a real source_reference", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], [
      { id: "s1", source: "x_mention", source_reference: "https://x.com/i/web/status/123" },
    ]);
    expect(result!.sourceUrl).toBe("https://x.com/i/web/status/123");
  });

  it("does not attach a sourceUrl for multi-signal opportunities", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1", "s2"] });
    const [result] = enrichWithSourceUrls([opp], [
      { id: "s1", source: "x_mention", source_reference: "https://x.com/i/web/status/123" },
    ]);
    expect(result!.sourceUrl).toBeUndefined();
  });

  it("does not attach a sourceUrl for non-x_mention signals", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], [
      { id: "s1", source: "youtube_video", source_reference: "https://youtube.com/watch?v=abc" },
    ]);
    expect(result!.sourceUrl).toBeUndefined();
  });

  it("does not attach a sourceUrl when source_reference is null", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], [{ id: "s1", source: "x_mention", source_reference: null }]);
    expect(result!.sourceUrl).toBeUndefined();
  });

  it("leaves an opportunity untouched when its signal id isn't in the fetched rows", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], []);
    expect(result!.sourceUrl).toBeUndefined();
  });

  it("attaches authorHandle alongside sourceUrl when the signal's evidence has one", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], [
      {
        id: "s1",
        source: "x_mention",
        source_reference: "https://x.com/i/web/status/123",
        evidence: { authorHandle: "someTrader" },
      },
    ]);
    expect(result!.authorHandle).toBe("someTrader");
  });

  it("does not attach authorHandle when the signal's evidence has none", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1"] });
    const [result] = enrichWithSourceUrls([opp], [
      { id: "s1", source: "x_mention", source_reference: "https://x.com/i/web/status/123", evidence: { authorHandle: null } },
    ]);
    expect(result!.authorHandle).toBeUndefined();
  });

  it("does not attach authorHandle when the opportunity has no sourceUrl either", () => {
    const opp = makeOpportunity({ id: "a", signalIds: ["s1", "s2"] });
    const [result] = enrichWithSourceUrls([opp], [
      {
        id: "s1",
        source: "x_mention",
        source_reference: "https://x.com/i/web/status/123",
        evidence: { authorHandle: "someTrader" },
      },
    ]);
    expect(result!.authorHandle).toBeUndefined();
  });
});
