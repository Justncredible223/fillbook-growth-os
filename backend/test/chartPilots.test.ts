import { describe, it, expect } from "vitest";
import { CHART_PILOTS, chartAPlan, chartBPlan, chartCPlan } from "../src/shortform/chartPilots";
import { MOTION_SCENE_PLANS, isPayoffPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar, scoreStory } from "../src/shortform/storyScore";

const manifest = loadManifest();

describe("chart-card concepts", () => {
  it("are three concepts, each an A+ that clears the render bar", () => {
    expect(CHART_PILOTS.map((p) => p.planId)).toEqual(["chart-a-17-green-days", "chart-b-10-green-days", "chart-c-one-signal-two-accounts"]);
    for (const p of CHART_PILOTS) {
      expect(scoreStory(p).grade, p.planId).toBe("A+");
      expect(renderBar(p).ok).toBe(true);
    }
  });

  it("are in the catalog once each, with titles no other concept uses, and use the payoff render settings", () => {
    const titles = MOTION_SCENE_PLANS.map((p) => p.title.toLowerCase());
    for (const p of CHART_PILOTS) {
      expect(MOTION_SCENE_PLANS.filter((x) => x.planId === p.planId)).toHaveLength(1);
      expect(titles.filter((t) => t === p.title.toLowerCase())).toHaveLength(1);
      expect(isPayoffPlan(p)).toBe(true);
    }
  });

  it("pass the full claims and evidence validation with the recordings' hashes checked", () => {
    for (const p of CHART_PILOTS) {
      const v = validateScenePlan(p, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error"), p.planId).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("are silent: no voiceover, a text-only narration, the same headline on every scene", () => {
    for (const p of CHART_PILOTS) {
      expect(p.voiceover).toBe("none");
      expect(p.scenes.every((s) => s.layout === "chart" && s.crop === null && s.focalRegion === null)).toBe(true);
      expect(new Set(p.scenes.map((s) => s.headline)).size).toBe(1);
      expect(p.scenes[0]!.headline).toBe(p.hook);
    }
  });

  it("run 12 to 13 seconds, with exactly one closing invitation on the last scene", () => {
    for (const p of CHART_PILOTS) {
      const total = p.scenes.reduce((n, s) => n + s.durationSeconds, 0);
      expect(total, p.planId).toBeGreaterThanOrEqual(12);
      expect(total, p.planId).toBeLessThanOrEqual(13);
      expect(p.scenes.filter((s) => s.cta)).toHaveLength(1);
      expect(p.scenes[p.scenes.length - 1]!.cta).toContain("@fillbookhq");
      expect(p.scenes.map((s) => s.chart!.stage)).toEqual([1, 2, 3, 4]);
      expect(p.scenes[p.scenes.length - 1]!.chart!.dim).toBe(true);
    }
  });

  it("draw their numbers from the recordings the scenes cite, and say only what the facts say", () => {
    const a = chartAPlan();
    expect(a.scenes[0]!.chart!.grid).toMatchObject({ total: 18, good: 17, badAt: [13] });
    expect(a.scenes[0]!.chart!.progress).toMatchObject({ value: 7515.96, target: 9000, gapLabel: "$1,484 to go" });
    const b = chartBPlan();
    expect(b.scenes[0]!.chart!.grid).toMatchObject({ total: 10, good: 10, badAt: [] });
    expect(b.scenes[0]!.chart!.progress).toMatchObject({ value: 2940, target: 3000, gapLabel: "$60 to go" });
    const c = chartCPlan();
    expect(c.scenes[0]!.assetId).toBe("rec.hs-multi-account-a.v1");
    expect(c.scenes[1]!.assetId).toBe("rec.hs-multi-account-b.v1");
    for (const p of CHART_PILOTS) {
      const text = p.scenes.map((s) => `${s.narration} ${s.headline} ${s.captionText} ${s.cta ?? ""} ${s.claims.map((x) => x.text).join(" ")}`).join(" ");
      expect(text, p.planId).not.toMatch(/real.?time|\blive\b|guarantee|before (a|you) breach|any broker|financial advice|never blow|you will (pass|profit|earn)|because you|you were/i);
    }
  });
});
