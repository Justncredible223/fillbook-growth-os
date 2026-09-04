import { describe, it, expect } from "vitest";
import { twoProportionZTest } from "../src/experiments/statisticalTest";

describe("twoProportionZTest", () => {
  it("returns insufficientSample when either group is below the minimum", () => {
    const result = twoProportionZTest({ successes: 1, total: 2 }, { successes: 8, total: 10 });
    expect(result.insufficientSample).toBe(true);
    expect(result.isSignificant).toBe(false);
  });

  it("detects a clear, large, significant difference with enough samples", () => {
    // 10% vs 90% pass rate at n=20 each -- an obvious, large effect.
    const result = twoProportionZTest({ successes: 2, total: 20 }, { successes: 18, total: 20 });
    expect(result.insufficientSample).toBe(false);
    expect(result.isSignificant).toBe(true);
    expect(result.absoluteDifference).toBeCloseTo(0.8, 2);
    expect(result.pValue).toBeLessThan(0.05);
  });

  it("does not claim significance for a small, plausibly-noise difference", () => {
    const result = twoProportionZTest({ successes: 10, total: 20 }, { successes: 11, total: 20 });
    expect(result.isSignificant).toBe(false);
  });

  it("handles a zero-total sample without crashing", () => {
    const result = twoProportionZTest({ successes: 0, total: 0 }, { successes: 5, total: 10 });
    expect(result.controlRate).toBeNull();
    expect(result.isSignificant).toBe(false);
    expect(result.insufficientSample).toBe(true);
  });

  it("reports a negative difference when treatment underperforms control", () => {
    const result = twoProportionZTest({ successes: 18, total: 20 }, { successes: 2, total: 20 });
    expect(result.absoluteDifference).toBeLessThan(0);
    expect(result.isSignificant).toBe(true);
  });

  it("is symmetric: p-value magnitude doesn't depend on direction", () => {
    const a = twoProportionZTest({ successes: 5, total: 20 }, { successes: 15, total: 20 });
    const b = twoProportionZTest({ successes: 15, total: 20 }, { successes: 5, total: 20 });
    expect(a.pValue).toBeCloseTo(b.pValue!, 6);
  });
});
