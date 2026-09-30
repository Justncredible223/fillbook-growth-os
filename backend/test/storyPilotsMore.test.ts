import { describe, it, expect } from "vitest";
import { MORE_STORY_PILOTS, pilot19StoryPlan, pilot21StoryPlan, pilot22StoryPlan } from "../src/shortform/storyPilotsMore";
import { MOTION_SCENE_PLANS, isPayoffPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar, scoreStory } from "../src/shortform/storyScore";
import { payoffWordCount, splitPayoffHeadline } from "../src/shortform/payoffLayout";

const manifest = loadManifest();

describe("story rebuilds of pilots 19, 21 and 22", () => {
  it("are three concepts, each an A+ that clears the render bar", () => {
    expect(MORE_STORY_PILOTS.map((p) => p.planId)).toEqual(["pilot-19-story-a", "pilot-21-story-a", "pilot-22-story-a"]);
    for (const p of MORE_STORY_PILOTS) {
      expect(scoreStory(p).grade).toBe("A+");
      expect(renderBar(p).ok).toBe(true);
    }
  });

  it("are in the catalog once each, with titles no other concept uses", () => {
    const titles = MOTION_SCENE_PLANS.map((p) => p.title.toLowerCase());
    for (const p of MORE_STORY_PILOTS) {
      expect(MOTION_SCENE_PLANS.filter((x) => x.planId === p.planId)).toHaveLength(1);
      expect(titles.filter((t) => t === p.title.toLowerCase())).toHaveLength(1);
      expect(isPayoffPlan(p)).toBe(true);
    }
  });

  it("pass the full claims and evidence validation with the recordings' hashes checked", () => {
    for (const p of MORE_STORY_PILOTS) {
      const v = validateScenePlan(p, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error"), p.planId).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("open on a figure with a hook that has stakes, keep words per screen low and stay 12 to 20 seconds", () => {
    for (const p of MORE_STORY_PILOTS) {
      expect(splitPayoffHeadline(p.scenes[0]!.headline)?.big, p.planId).toBeTruthy();
      expect(p.scenes[0]!.payoff?.leadWithWords).toBeUndefined();
      for (const s of p.scenes) expect(payoffWordCount(s.headline)).toBeLessThanOrEqual(7);
      const total = p.scenes.reduce((n, s) => n + s.durationSeconds, 0);
      expect(total, p.planId).toBeGreaterThanOrEqual(12);
      expect(total, p.planId).toBeLessThanOrEqual(20.5);
    }
  });

  it("explain the target before leaning on it, and end on the hook's own figure with the one invitation", () => {
    for (const p of [pilot19StoryPlan(), pilot21StoryPlan()]) {
      expect(p.scenes.some((s) => /profit target is (what|the amount)/i.test(s.narration)), p.planId).toBe(true);
    }
    for (const p of MORE_STORY_PILOTS) {
      const last = p.scenes[p.scenes.length - 1]!;
      expect(p.scenes.filter((s) => s.cta)).toHaveLength(1);
      expect(last.cta).toContain("@fillbookhq");
      const hookFigure = p.hook.match(/-?\$?\d[\d,]*/)![0].replace(/^-/, "");
      expect(`${last.headline} ${last.narration}`).toContain(hookFigure);
    }
  });

  it("tell the story each concept promises", () => {
    const p19 = pilot19StoryPlan().scenes.map((s) => s.narration).join(" ");
    expect(p19).toMatch(/17 green days out of 18.*one red day: minus \$1,504.*\$1,484 short.*almost exactly the size of one red day/i);
    const p21 = pilot21StoryPlan().scenes.map((s) => s.narration).join(" ");
    expect(p21).toMatch(/10 green days in a row.*98% of the target: \$2,940 of \$3,000/i);
    const p22 = pilot22StoryPlan().scenes.map((s) => s.narration).join(" ");
    expect(p22).toMatch(/Account A: minus \$1,201.*Account B: the same minus \$1,201.*shows up twice/i);
  });

  it("show the two accounts on their own recordings", () => {
    const s = pilot22StoryPlan().scenes;
    expect(s[0]!.assetId).toBe("rec.hs-multi-account-a.v1");
    expect(s[1]!.assetId).toBe("rec.hs-multi-account-b.v1");
  });

  it("make no claim Fillbook cannot support: no real-time, live, guarantee, advice or coverage wording", () => {
    for (const p of MORE_STORY_PILOTS) {
      const text = p.scenes.map((s) => `${s.narration} ${s.headline} ${s.captionText} ${s.cta ?? ""} ${s.claims.map((c) => c.text).join(" ")}`).join(" ");
      expect(text, p.planId).not.toMatch(/real.?time|\blive\b|guarantee|before (a|you) breach|any broker|financial advice|never blow|you will (pass|profit|earn)/i);
    }
  });

  it("zoom each evidence scene into one line of the real recording, at a zoom that stays sharp", () => {
    for (const p of MORE_STORY_PILOTS) {
      for (const s of p.scenes.filter((x) => x.assetId)) {
        expect(s.crop!.w * s.crop!.h).toBeLessThan(400 * 110);
        expect(s.payoff?.cursor).toBe(true);
        expect(s.crop!.w).toBeGreaterThanOrEqual(300);
      }
    }
  });
});
