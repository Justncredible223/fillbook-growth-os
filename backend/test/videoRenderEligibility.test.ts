import { describe, it, expect } from "vitest";
import { evaluateVideoRenderMonthlyCap, evaluateVideoRenderDailyCap, evaluateVideoStorageCap, MAX_VIDEO_RENDERS_PER_DAY } from "../src/video/videoRenderEligibility";

describe("evaluateVideoRenderMonthlyCap", () => {
  it("is eligible below the cap", () => {
    expect(evaluateVideoRenderMonthlyCap(5, 30).eligible).toBe(true);
  });

  it("is ineligible once at the cap", () => {
    const result = evaluateVideoRenderMonthlyCap(30, 30);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/monthly_render_cap_reached/);
  });
});

describe("evaluateVideoRenderDailyCap", () => {
  it("is eligible below the cap", () => {
    expect(evaluateVideoRenderDailyCap(0, 2).eligible).toBe(true);
    expect(evaluateVideoRenderDailyCap(1, 2).eligible).toBe(true);
  });

  it("is ineligible once at the cap -- real incident regression: 2 renders/day is the owner's actual posting limit", () => {
    const result = evaluateVideoRenderDailyCap(2, 2);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/daily_render_cap_reached/);
  });

  it("defaults to MAX_VIDEO_RENDERS_PER_DAY (2) when no cap is given", () => {
    expect(evaluateVideoRenderDailyCap(1).eligible).toBe(true);
    expect(evaluateVideoRenderDailyCap(MAX_VIDEO_RENDERS_PER_DAY).eligible).toBe(false);
  });
});

describe("evaluateVideoStorageCap", () => {
  it("is eligible when committed + reserved + requested fits under the cap", () => {
    expect(evaluateVideoStorageCap(100, 100, 100, 500).eligible).toBe(true);
  });

  it("is ineligible when committed + reserved + requested exceeds the cap", () => {
    const result = evaluateVideoStorageCap(300, 150, 100, 500);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/storage_cap_reached/);
  });
});
