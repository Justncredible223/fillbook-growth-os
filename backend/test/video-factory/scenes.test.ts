import { describe, it, expect } from "vitest";
import { classifyShot, buildScenePlan, buildSceneLabelCues } from "../../scripts/video-factory/scenes";

describe("classifyShot", () => {
  it("always classifies the first shot as hook, regardless of text", () => {
    expect(classifyShot("Fillbook UI: dashboard screenshot", 0)).toBe("hook");
  });

  it("classifies product shots by UI/screenshot keywords", () => {
    expect(classifyShot("Fillbook UI: example drawdown chart (demo data)", 1)).toBe("product");
    expect(classifyShot("Screenshot of the trade log", 1)).toBe("product");
  });

  it("classifies CTA shots by call-to-action keywords", () => {
    expect(classifyShot("Text card: try Fillbook free", 1)).toBe("cta");
    expect(classifyShot("Follow for more", 1)).toBe("cta");
  });

  it("classifies metric shots by number/stat keywords", () => {
    expect(classifyShot("Text card: 73% of funded accounts fail", 1)).toBe("metric");
    expect(classifyShot("Stat card: the number", 1)).toBe("metric");
  });

  it("falls back to explanation for plain descriptive shots", () => {
    expect(classifyShot("Talking head, explaining the concept", 1)).toBe("explanation");
  });
});

describe("buildScenePlan", () => {
  it("splits total duration evenly across all shots", () => {
    const scenes = buildScenePlan(["hook shot", "explain", "cta"], 30);
    expect(scenes).toHaveLength(3);
    expect(scenes.every((s) => s.durationSeconds === 10)).toBe(true);
  });

  it("assigns a distinct background color per scene kind", () => {
    const scenes = buildScenePlan(["hook", "Fillbook UI screenshot", "try Fillbook now"], 30);
    const colors = new Set(scenes.map((s) => s.backgroundColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("throws on an empty shot list rather than dividing by zero", () => {
    expect(() => buildScenePlan([], 30)).toThrow(/empty shot list/);
  });

  it("is deterministic -- same input always produces the same plan", () => {
    const a = buildScenePlan(["one", "two", "three"], 21);
    const b = buildScenePlan(["one", "two", "three"], 21);
    expect(a).toEqual(b);
  });
});

describe("buildSceneLabelCues", () => {
  it("suppresses the label for hook/explanation scenes -- only viewer-safe fixed tags are ever shown, never raw shot-list text", () => {
    const scenes = buildScenePlan(["hook shot", "just explaining something"], 10);
    expect(buildSceneLabelCues(scenes)).toHaveLength(0);
  });

  it("times each labeled scene's cue to its scene's window, back to back", () => {
    // Index 0 is always classified as "hook" (suppressed), so use a 3rd
    // shot to exercise two distinct labeled scenes.
    const scenes = buildScenePlan(["opening", "Fillbook UI screenshot", "try Fillbook now"], 12);
    const cues = buildSceneLabelCues(scenes);
    expect(cues).toHaveLength(2);
    expect(cues[0]!.label).toBe("FILLBOOK");
    expect(cues[1]!.label).toBe("TRY FILLBOOK");
    expect(cues[0]!.startSeconds).toBe(4);
    expect(cues[0]!.endSeconds).toBe(8);
    expect(cues[1]!.startSeconds).toBe(8);
    expect(cues[1]!.endSeconds).toBe(12);
  });
});
