import { describe, it, expect } from "vitest";
import { buildUtmParams, utmQueryString } from "../src/attribution/utmBuilder";

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
