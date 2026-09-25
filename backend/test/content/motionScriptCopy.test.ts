import { describe, it, expect } from "vitest";
import { buildVideoScriptFromScenePlan } from "../../src/content/videoScriptWriter.js";
import { PILOTS } from "../../src/shortform/pilots.js";

describe("motion-concept platform copy", () => {
  for (const plan of PILOTS) {
    it(`${plan.planId}: every caption says the numbers are demo data and never calls them real`, () => {
      const v = buildVideoScriptFromScenePlan(plan);
      for (const text of [v.youtubeDescription, v.tiktokCaption, v.instagramCaption ?? ""]) {
        expect(text.toLowerCase()).toContain("demo");
        expect(text).not.toMatch(/\breal,? verified\b/i);
      }
      expect(v.youtubeDescription).toContain("not a real trader's results");
    });
  }
});
