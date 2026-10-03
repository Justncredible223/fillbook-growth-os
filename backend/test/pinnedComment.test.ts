import { describe, it, expect } from "vitest";
import { PINNED_COMMENT_LINK, PINNED_COMMENT_TEMPLATES, buildPinnedComment } from "../src/video/pinnedComment";
import { MOTION_SCENE_PLANS } from "../src/shortform/motionPlans";

describe("buildPinnedComment", () => {
  it("always gives the same comment for the same video, and always points at the free sample", () => {
    expect(buildPinnedComment("Moved stops cost $656")).toBe(buildPinnedComment("Moved stops cost $656"));
    for (const plan of MOTION_SCENE_PLANS) expect(buildPinnedComment(plan.hook)).toContain(PINNED_COMMENT_LINK);
  });

  it("varies across videos, so the same comment is not pinned under every one", () => {
    const used = new Set(MOTION_SCENE_PLANS.map((p) => buildPinnedComment(p.hook)));
    expect(used.size).toBe(PINNED_COMMENT_TEMPLATES.length);
  });

  it("keeps the guardrails: sample data is said, nothing is promised, nothing is called live", () => {
    for (const t of PINNED_COMMENT_TEMPLATES) {
      expect(t).toMatch(/sample|demo/i);
      expect(t).not.toMatch(/\b(live|real[- ]?time|guarantee|profit|pass(?:ing)? (?:your|the) eval|you will)\b/i);
      expect(t).not.toMatch(/[*_#@]/); // plain text: no markup, no hashtags, no mentions
      expect(t.length).toBeLessThanOrEqual(150); // well inside both platforms' comment limits
    }
  });
});
