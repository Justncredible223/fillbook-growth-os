import { describe, expect, it } from "vitest";
import { PILOTS, PILOT_1, PILOT_2, PILOT_3, pilotMetadata } from "../../src/shortform/pilots";
import { loadManifest, validateScenePlan } from "../../src/shortform/scenePlan";
import { validatePublishedMetadata } from "../../src/shortform/metadata";

describe("the three pilots from the approved creative direction", () => {
  it("cover the three named videos and series", () => {
    expect(PILOT_1.title).toBe("Green month. Losing setup.");
    expect(PILOT_1.series).toBe("What the Total Hides");
    expect(PILOT_2.title).toBe("Balance isn't your buffer.");
    expect(PILOT_2.series).toBe("Read the Rule");
    expect(PILOT_3.title).toBe("Same setup. Bigger size.");
    expect(PILOT_3.series).toBe("One Trade to Review");
  });

  it("every pilot follows problem -> example -> evidence -> takeaway -> one invitation", () => {
    for (const plan of PILOTS) {
      expect(plan.scenes.length).toBeGreaterThanOrEqual(4);
      const ctaScenes = plan.scenes.filter((s) => s.cta);
      expect(ctaScenes).toHaveLength(1);
      expect(ctaScenes[0]).toBe(plan.scenes[plan.scenes.length - 1]);
      expect(plan.scenes.some((s) => s.assetId !== null)).toBe(true);
    }
  });

  it("all three pilots are fully ready: structurally valid against the real manifest, no missing assets (owner captured the remaining screenshots 2026-09-21)", () => {
    const manifest = loadManifest();
    for (const plan of PILOTS) {
      const v = validateScenePlan(plan, manifest, { checkFiles: true });
      expect(v.blockedByMissingAssets, plan.planId).toBe(false);
      expect(v.missingAssets, plan.planId).toEqual([]);
      expect(v.ok, `${plan.planId}: ${JSON.stringify(v.issues.filter((i) => i.severity === "error"))}`).toBe(true);
    }
  });

  it("Pilot 3's real flagged trade is framed as a review prompt, never a diagnosis or proof of intent", () => {
    const flaggedScene = PILOT_3.scenes.find((s) => s.sceneId === "p3-s2-flagged")!;
    expect(flaggedScene.narration.toLowerCase()).not.toMatch(/proves|diagnos/);
    const promptScene = PILOT_3.scenes.find((s) => s.sceneId === "p3-s3-prompt")!;
    expect(promptScene.narration).toMatch(/prompt/i);
  });

  it("Pilot 2's qualification scene says results depend on recorded trades and settings, and never claims a live risk system", () => {
    const qualify = PILOT_2.scenes.find((s) => s.sceneId === "p2-s6-qualify")!;
    expect(qualify.narration.toLowerCase()).toContain("record");
    expect(qualify.narration.toLowerCase()).toContain("configure");
    for (const plan of PILOTS) for (const scene of plan.scenes) expect(scene.narration.toLowerCase()).not.toMatch(/replaces|real-time risk|live risk/);
  });

  it("every pilot's metadata is valid for every platform it targets", () => {
    for (const plan of PILOTS) {
      for (const platform of plan.platforms) {
        const meta = pilotMetadata(plan, platform);
        expect(validatePublishedMetadata(meta).filter((i) => i.severity === "error")).toEqual([]);
      }
    }
  });
});
