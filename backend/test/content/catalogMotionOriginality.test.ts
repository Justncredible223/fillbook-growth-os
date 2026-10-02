import { describe, it, expect } from "vitest";
import { MOTION_SCENE_PLANS, isChartPlan } from "../../src/shortform/motionPlans.js";
import { buildVideoScriptFromScenePlan, formatVideoScriptAsText } from "../../src/content/videoScriptWriter.js";
import { isCatalogMotionScript } from "../../src/content/campaignPipeline.js";
import { OriginalityEngine, } from "../../src/content/originalityEngine.js";
import { spokenScriptOf } from "../../src/content/contentQualityGate.js";

const draftOf = (planId: string) => formatVideoScriptAsText(buildVideoScriptFromScenePlan(MOTION_SCENE_PLANS.find((p) => p.planId === planId)!));
const maxOverlap = (candidate: string, recent: string[]) =>
  new OriginalityEngine().compareAgainstRecent(spokenScriptOf(candidate), recent.map(spokenScriptOf))[0]?.similarity ?? 0;

describe("catalog motion scripts vs the originality gate", () => {
  const chartIds = MOTION_SCENE_PLANS.filter(isChartPlan).map((p) => p.planId);

  it("recognises stored drafts of catalog scripts, and nothing else", () => {
    expect(isCatalogMotionScript(draftOf(chartIds[0]!))).toBe(true);
    expect(isCatalogMotionScript("HOOK: Something new\n\nSCRIPT:\nA freshly written script that is not in the catalog.\n\nSHOT LIST:\n1. x")).toBe(false);
    expect(isCatalogMotionScript("a plain text post")).toBe(false);
  });

  it("regression: chart concepts overlap each other enough to trip the 0.6 gate unless catalog drafts are excluded", () => {
    const recentAll = chartIds.map(draftOf);
    const blockedWithout = chartIds.filter((id) => maxOverlap(draftOf(id), recentAll.filter((t) => t !== draftOf(id))) >= 0.6);
    expect(blockedWithout.length).toBeGreaterThan(0);
    for (const id of chartIds) {
      const recent = recentAll.filter((t) => t !== draftOf(id)).filter((t) => !isCatalogMotionScript(t));
      expect(maxOverlap(draftOf(id), recent)).toBeLessThan(0.6);
    }
  });
});
