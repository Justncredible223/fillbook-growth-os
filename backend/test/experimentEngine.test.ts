import { describe, it, expect } from "vitest";
import { interpretExperiment } from "../src/experiments/experimentEngine";

const now = new Date("2026-09-03T00:00:00Z");

describe("interpretExperiment", () => {
  it("flags insufficient sample with a clear, honest message", () => {
    const result = interpretExperiment({ successes: 1, total: 2 }, { successes: 2, total: 3 }, now);
    expect(result.insufficientSample).toBe(true);
    expect(result.interpretation).toContain("Not enough data yet");
  });

  it("describes a significant improvement in plain language", () => {
    const result = interpretExperiment({ successes: 2, total: 20 }, { successes: 18, total: 20 }, now);
    expect(result.isSignificant).toBe(true);
    expect(result.interpretation).toContain("improved");
    expect(result.interpretation).toContain("Statistically significant");
  });

  it("describes a significant decline in plain language", () => {
    const result = interpretExperiment({ successes: 18, total: 20 }, { successes: 2, total: 20 }, now);
    expect(result.isSignificant).toBe(true);
    expect(result.interpretation).toContain("declined");
  });

  it("never claims significance for a noisy small difference", () => {
    const result = interpretExperiment({ successes: 10, total: 20 }, { successes: 11, total: 20 }, now);
    expect(result.isSignificant).toBe(false);
    expect(result.interpretation).toContain("No statistically significant difference");
  });

  it("records sample sizes and a computedAt timestamp", () => {
    const result = interpretExperiment({ successes: 5, total: 10 }, { successes: 6, total: 10 }, now);
    expect(result.controlSampleSize).toBe(10);
    expect(result.treatmentSampleSize).toBe(10);
    expect(result.computedAt).toBe(now.toISOString());
  });
});
