import { describe, it, expect } from "vitest";
import { resolveDailyPipelineGroups } from "../api/daily-pipeline";

describe("resolveDailyPipelineGroups", () => {
  it("no group flag at all (manual run-now) runs both -- same 'everything' default as growth-pulse.ts's own resolveStepGroups", () => {
    expect(resolveDailyPipelineGroups({})).toEqual({ core: true, xFeedPost: true });
  });

  it("the 06:00 Phoenix cron slot: core only, never x_feed_post in the same invocation", () => {
    expect(resolveDailyPipelineGroups({ group: "core" })).toEqual({ core: true, xFeedPost: false });
  });

  it("the 07:00 Phoenix cron slot: x_feed_post only, never core in the same invocation -- this is the timeout-isolation the split exists for", () => {
    expect(resolveDailyPipelineGroups({ group: "x_feed_post" })).toEqual({ core: false, xFeedPost: true });
  });

  it("an unrecognized group value runs neither, rather than guessing", () => {
    expect(resolveDailyPipelineGroups({ group: "typo" })).toEqual({ core: false, xFeedPost: false });
  });
});
