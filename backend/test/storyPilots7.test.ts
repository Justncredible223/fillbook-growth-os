import { describe, it, expect } from "vitest";
import { PILOT7_STORY_PILOTS } from "../src/shortform/storyPilots7";
import { MOTION_SCENE_PLANS, isPayoffPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar, scoreStory } from "../src/shortform/storyScore";
import { payoffWordCount, splitPayoffHeadline } from "../src/shortform/payoffLayout";

const manifest = loadManifest();

describe("story rebuilds of pilot 7, the Daily Brief that broke out", () => {
  it("are three concepts, each an A+ that clears the render bar", () => {
    expect(PILOT7_STORY_PILOTS.map((p) => p.planId)).toEqual(["pilot-7-story-a", "pilot-7-story-b", "pilot-7-story-c"]);
    for (const p of PILOT7_STORY_PILOTS) {
      expect(scoreStory(p).grade).toBe("A+");
      expect(renderBar(p).ok).toBe(true);
    }
  });

  it("are in the catalog once each, with titles no other concept uses", () => {
    const titles = MOTION_SCENE_PLANS.map((p) => p.title.toLowerCase());
    for (const p of PILOT7_STORY_PILOTS) {
      expect(MOTION_SCENE_PLANS.filter((x) => x.planId === p.planId)).toHaveLength(1);
      expect(titles.filter((t) => t === p.title.toLowerCase())).toHaveLength(1);
      expect(isPayoffPlan(p)).toBe(true);
    }
  });

  it("pass the full claims and evidence validation with the recording's hash checked", () => {
    for (const p of PILOT7_STORY_PILOTS) {
      const v = validateScenePlan(p, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error"), p.planId).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("open on a figure, keep words per screen low, stay 12 to 20 seconds, and only ever use the Daily Brief recording", () => {
    for (const p of PILOT7_STORY_PILOTS) {
      expect(splitPayoffHeadline(p.scenes[0]!.headline)?.big, p.planId).toBeTruthy();
      for (const s of p.scenes) {
        expect(payoffWordCount(s.headline)).toBeLessThanOrEqual(7);
        if (s.assetId) expect(s.assetId).toBe("rec.p7-daily-brief.v1");
      }
      const total = p.scenes.reduce((n, s) => n + s.durationSeconds, 0);
      expect(total, p.planId).toBeGreaterThanOrEqual(12);
      expect(total, p.planId).toBeLessThanOrEqual(20.5);
    }
  });

  it("end on the hook's own figure with the one invitation", () => {
    for (const p of PILOT7_STORY_PILOTS) {
      const last = p.scenes[p.scenes.length - 1]!;
      expect(p.scenes.filter((s) => s.cta)).toHaveLength(1);
      expect(last.cta).toContain("@fillbookhq");
      expect(last.headline).toBe("Read this before your first trade.");
      const hookFigures = (p.hook.match(/-?\$?\d[\d,]*%?/g) ?? []).map((f) => f.replace(/^-/, ""));
      expect(hookFigures.some((f) => `${last.headline} ${last.narration}`.includes(f)), p.planId).toBe(true);
    }
  });

  it("tell the story each concept promises, from figures on the recording", () => {
    const text = (p: (typeof PILOT7_STORY_PILOTS)[number]) => p.scenes.map((s) => s.narration).join(" ");
    expect(text(PILOT7_STORY_PILOTS[0]!)).toMatch(/\$1,725 of room.*But today.*only lose \$1,000.*smaller number/i);
    expect(text(PILOT7_STORY_PILOTS[1]!)).toMatch(/64% win rate over 22 trades.*first hour.*check your own record/i);
    expect(text(PILOT7_STORY_PILOTS[2]!)).toMatch(/minus \$17.*\$1,725 of room.*bigger loss/i);
  });

  it("make no claim the recording cannot support: no live, real-time, guarantee, advice, or what happens at a limit", () => {
    for (const p of PILOT7_STORY_PILOTS) {
      const text = p.scenes.map((s) => `${s.narration} ${s.headline} ${s.captionText} ${s.cta ?? ""} ${s.claims.map((c) => c.text).join(" ")}`).join(" ");
      expect(text, p.planId).not.toMatch(/real.?time|\blive\b|guarantee|before (a|you) breach|any broker|financial advice|never blow|you will (pass|profit|earn)|ends? your day|worse|worst|blocked|protect|alert/i);
    }
  });

  it("zoom each evidence scene into one line of the recording, with the pointer on it", () => {
    for (const p of PILOT7_STORY_PILOTS) {
      for (const s of p.scenes.filter((x) => x.assetId)) {
        expect(s.payoff?.cursor).toBe(true);
        expect(s.crop!.w).toBeGreaterThanOrEqual(300);
        expect(s.crop!.w * s.crop!.h).toBeLessThan(80000);
      }
    }
  });
});
