import { describe, it, expect } from "vitest";
import { buildPinnedComments } from "../src/video/pinnedComment";
import { buildDestinationUrl } from "../src/attribution/utmBuilder";

describe("buildPinnedComments", () => {
  const assetId = "3f2a9c6e-1111-4222-8333-444455556666";
  const thesis = "One trade, $1,504.04 -- the day payout math flipped.";

  it("points at the no-signup demo with the platform's own tracked link", () => {
    const c = buildPinnedComments(assetId, thesis);
    expect(c.tiktok).toContain("https://www.fillbookhq.com/sample?");
    expect(c.tiktok).toContain("utm_source=tiktok");
    expect(c.youtube).toContain("utm_source=youtube");
    for (const text of [c.tiktok, c.youtube]) {
      expect(text).toContain(`utm_content=${assetId}`);
      expect(text).toContain("utm_medium=organic_social");
    }
  });

  it("is the same link the destination builder would give for /sample", () => {
    const c = buildPinnedComments(assetId, thesis);
    expect(c.tiktok.endsWith(buildDestinationUrl(assetId, "tiktok", thesis, "/sample"))).toBe(true);
  });

  it("makes no earnings, guarantee, or advice claims and says the demo needs no signup", () => {
    const c = buildPinnedComments(assetId, thesis);
    for (const text of [c.tiktok, c.youtube]) {
      expect(text).toMatch(/no signup/i);
      expect(text).not.toMatch(/guarantee|profit|earn|pass(ing)? your|financial advice|live|real-time/i);
      expect(text.length).toBeLessThan(400);
    }
  });
});

describe("buildDestinationUrl allows /sample", () => {
  it("accepts /sample and still rejects unlisted paths", () => {
    expect(buildDestinationUrl("a", "tiktok", "t", "/sample").startsWith("https://www.fillbookhq.com/sample?")).toBe(true);
    expect(() => buildDestinationUrl("a", "tiktok", "t", "/admin")).toThrow(/not an approved/);
  });
});
