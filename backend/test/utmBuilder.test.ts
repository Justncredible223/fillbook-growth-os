import { describe, it, expect } from "vitest";
import { buildUtmParams, utmQueryString, buildDestinationUrl } from "../src/attribution/utmBuilder";

describe("buildUtmParams", () => {
  it("builds consistent params from platform, thesis, and asset id", () => {
    const params = buildUtmParams("asset-123", "X", "Trailing drawdown confuses traders");
    expect(params.utm_source).toBe("x");
    expect(params.utm_medium).toBe("organic_social");
    expect(params.utm_campaign).toBe("trailing_drawdown_confuses_traders");
    expect(params.utm_content).toBe("asset-123");
  });

  it("slugifies punctuation and mixed case in the campaign thesis", () => {
    const params = buildUtmParams("a", "tiktok", "A profitable day can STILL be bad!!");
    expect(params.utm_campaign).toMatch(/^[a-z0-9_]+$/);
    expect(params.utm_campaign).not.toContain("!");
  });

  it("falls back to a safe default for an empty/unslugifiable thesis", () => {
    const params = buildUtmParams("a", "x", "!!!");
    expect(params.utm_campaign).toBe("campaign");
  });

  it("truncates a very long thesis to a reasonable length", () => {
    const longThesis = "a".repeat(200);
    const params = buildUtmParams("a", "x", longThesis);
    expect(params.utm_campaign.length).toBeLessThanOrEqual(40);
  });
});

describe("utmQueryString", () => {
  it("produces a valid, URL-encoded query string", () => {
    const qs = utmQueryString({
      utm_source: "x",
      utm_medium: "organic_social",
      utm_campaign: "test campaign",
      utm_content: "asset-1",
    });
    expect(qs).toBe("utm_source=x&utm_medium=organic_social&utm_campaign=test%20campaign&utm_content=asset-1");
  });
});

describe("buildDestinationUrl", () => {
  it("builds a full, ready-to-copy URL on the approved host, defaulting to the homepage", () => {
    const url = buildDestinationUrl("asset-1", "x", "Trailing drawdown confuses traders");
    expect(url).toBe(
      "https://www.fillbookhq.com/?utm_source=x&utm_medium=organic_social&utm_campaign=trailing_drawdown_confuses_traders&utm_content=asset-1",
    );
  });

  it("supports an explicit approved path", () => {
    const url = buildDestinationUrl("asset-1", "x", "topic", "/pricing");
    expect(url.startsWith("https://www.fillbookhq.com/pricing?")).toBe(true);
  });

  it("rejects a path outside the small approved allowlist -- never an open redirect to an arbitrary path", () => {
    expect(() => buildDestinationUrl("asset-1", "x", "topic", "/admin")).toThrow(/not an approved/);
    expect(() => buildDestinationUrl("asset-1", "x", "topic", "https://evil.example.com/")).toThrow(/not an approved/);
  });

  it("every generated destination is on the real fillbookhq.com host", () => {
    const url = buildDestinationUrl("asset-1", "tiktok", "topic");
    expect(new URL(url).hostname).toBe("www.fillbookhq.com");
    expect(new URL(url).protocol).toBe("https:");
  });
});
