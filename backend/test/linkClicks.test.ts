import { describe, it, expect } from "vitest";
import { isAllowedRedirectTarget } from "../src/attribution/linkClicks";

describe("isAllowedRedirectTarget", () => {
  it("allows https://fillbookhq.com and https://www.fillbookhq.com", () => {
    expect(isAllowedRedirectTarget("https://fillbookhq.com/pricing")).toBe(true);
    expect(isAllowedRedirectTarget("https://www.fillbookhq.com/")).toBe(true);
  });

  it("rejects other hosts, including lookalikes", () => {
    expect(isAllowedRedirectTarget("https://evil.example.com/")).toBe(false);
    expect(isAllowedRedirectTarget("https://fillbookhq.com.evil.com/")).toBe(false);
    expect(isAllowedRedirectTarget("https://notfillbookhq.com/")).toBe(false);
  });

  it("rejects non-https protocols even on an allowlisted host", () => {
    expect(isAllowedRedirectTarget("http://fillbookhq.com/")).toBe(false);
    expect(isAllowedRedirectTarget("javascript:alert(1)")).toBe(false);
  });

  it("rejects malformed URLs instead of throwing", () => {
    expect(isAllowedRedirectTarget("not a url")).toBe(false);
  });
});
