import { describe, it, expect } from "vitest";
import { STORY_PILOTS, pilot20StoryPlan } from "../src/shortform/storyPilots";
import { MOTION_SCENE_PLANS, isPayoffPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { MIN_RENDER_SCORE, renderBar, scoreStory } from "../src/shortform/storyScore";
import { payoffWordCount, splitPayoffHeadline } from "../src/shortform/payoffLayout";

const plan = pilot20StoryPlan();

describe("story rebuild of pilot 20 (the trailing floor)", () => {
  it("clears the render bar with an A+, so it is allowed to render", () => {
    const s = scoreStory(plan);
    expect(s.grade).toBe("A+");
    expect(s.score).toBeGreaterThanOrEqual(92);
    expect(renderBar(plan).ok).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(MIN_RENDER_SCORE);
  });

  it("is in the catalog, once, with a title no other concept uses", () => {
    expect(STORY_PILOTS.map((p) => p.planId)).toContain(plan.planId);
    const ids = MOTION_SCENE_PLANS.map((p) => p.planId);
    expect(ids.filter((id) => id === plan.planId)).toHaveLength(1);
    const titles = MOTION_SCENE_PLANS.map((p) => p.title.toLowerCase());
    expect(titles.filter((t) => t === plan.title.toLowerCase())).toHaveLength(1);
    expect(isPayoffPlan(plan)).toBe(true);
  });

  it("passes the full claims and evidence validation with the asset file hash checked", () => {
    const v = validateScenePlan(plan, loadManifest(), { checkFiles: true });
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("tells one story: the best day, the worst day, what a floor is, the account under it, the stakes, then the hook again", () => {
    const beats = plan.scenes.map((s) => s.narration);
    expect(beats[0]).toMatch(/best day ever.*3,100/i);
    expect(beats[1]).toMatch(/worst.*3,060/i);
    expect(beats[2]).toMatch(/trailing floor follows your peak, not your balance/i);
    expect(beats[3]).toMatch(/\$60 under its floor/i);
    expect(beats[4]).toMatch(/most firms close the account/i);
    expect(beats[5]).toMatch(/best day, then worst day/i);
    expect(plan.hook).toBe("Best day ever: +$3,100. Then -$3,060.");
  });

  it("explains the jargon before it leans on it", () => {
    const firstFloor = plan.scenes.findIndex((s) => /floor/i.test(s.narration));
    const gloss = plan.scenes.findIndex((s) => /floor follows your peak/i.test(s.narration));
    expect(gloss).toBeGreaterThanOrEqual(0);
    expect(gloss).toBeLessThanOrEqual(firstFloor);
  });

  it("opens on a figure, keeps words per screen low, and only later scenes may lead with words", () => {
    expect(splitPayoffHeadline(plan.scenes[0]!.headline)?.big).toBe("+$3,100");
    expect(plan.scenes[0]!.payoff?.leadWithWords).toBeUndefined();
    for (const s of plan.scenes) expect(payoffWordCount(s.headline)).toBeLessThanOrEqual(7);
    const total = plan.scenes.reduce((n, s) => n + s.durationSeconds, 0);
    expect(total).toBeGreaterThanOrEqual(12);
    expect(total).toBeLessThanOrEqual(20);
  });

  it("ends by looping back to the hook's two figures, with the one invitation and the handle once", () => {
    const last = plan.scenes[plan.scenes.length - 1]!;
    expect(last.headline).toBe("+$3,100. Then -$3,060.");
    expect(plan.scenes.filter((s) => s.cta)).toHaveLength(1);
    expect(last.cta).toContain("@fillbookhq");
  });

  it("makes no claim Fillbook cannot support: no real-time, live, guarantee or advice wording", () => {
    const text = plan.scenes.map((s) => `${s.narration} ${s.headline} ${s.captionText} ${s.cta ?? ""} ${s.claims.map((c) => c.text).join(" ")}`).join(" ");
    expect(text).not.toMatch(/real.?time|\blive\b|guarantee|before (a|you) breach|any broker|financial advice|never blow/i);
  });

  it("zooms each evidence scene into one line of the real recording, at a zoom that stays sharp", () => {
    for (const s of plan.scenes.filter((x) => x.assetId)) {
      expect(s.crop!.w * s.crop!.h).toBeLessThan(400 * 110);
      expect(s.payoff?.cursor).toBe(true);
    }
  });
});
