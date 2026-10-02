import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const config = JSON.parse(readFileSync(join(__dirname, "..", "vercel.json"), "utf-8")) as { functions: Record<string, { maxDuration: number }> };

describe("vercel.json function time limits", () => {
  // POST /api/summary { action: "regenerate" } runs a whole X post attempt (a draft plus nine reviewers) with a 55s
  // deadline (api/summary.ts). With no limit set for the file it ran under the platform default, was killed mid-attempt
  // before recording anything, and Home sat on "Generating..." indefinitely.
  it("gives api/summary.ts a limit above the 55s deadline its Regenerate action plans for", () => {
    expect(config.functions["api/summary.ts"]?.maxDuration).toBeGreaterThanOrEqual(60);
  });

  it("keeps the other long-running endpoints' limits", () => {
    expect(config.functions["api/run-campaign.ts"]?.maxDuration).toBe(120);
    expect(config.functions["api/daily-pipeline.ts"]?.maxDuration).toBe(60);
    expect(config.functions["api/growth-pulse.ts"]?.maxDuration).toBe(60);
  });
});
