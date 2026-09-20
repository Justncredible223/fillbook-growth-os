import { describe, it, expect } from "vitest";
import { classifyShot, buildScenePlan, buildSceneLabelCues, selectBestThumbnailSeconds } from "../../scripts/video-factory/scenes";
import type { Scene, WordCue } from "../../scripts/video-factory/types";

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

describe("buildScenePlan narration", () => {
  it("attaches the words spoken during each scene", () => {
    const words = "you revenge traded after a loss and sized up".split(" ");
    const wordCues = words.map((text, i) => ({ text, startSeconds: i * 0.5, endSeconds: i * 0.5 + 0.4 }));
    const scenes = buildScenePlan(["hook shot", "explain", "cta"], 5, wordCues);
    expect(scenes.map((s) => s.narration).join(" ").trim()).toBe(words.join(" "));
    expect(scenes.every((s) => typeof s.narration === "string")).toBe(true);
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

describe("buildScenePlan with narration word timing", () => {
  /** 24 words, 0.75s each back to back -> 18s of speech, a 0.5s pause after every 6th word (sentence break). */
  function narration(): WordCue[] {
    const words: WordCue[] = [];
    let t = 0;
    for (let i = 0; i < 24; i++) {
      words.push({ text: `w${i}`, startSeconds: t, endSeconds: t + 0.75 });
      t += 0.75 + ((i + 1) % 6 === 0 ? 0.5 : 0);
    }
    return words;
  }
  const total = 24 * 0.75 + 3 * 0.5 + 0.3;

  it("keeps every scene within the 1-3s pacing window and covers the whole video", () => {
    const scenes = buildScenePlan(["hook", "explain", "Fillbook UI screenshot", "try Fillbook now"], total, narration());
    for (const s of scenes) {
      expect(s.durationSeconds).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(s.durationSeconds).toBeLessThanOrEqual(3.5);
    }
    expect(scenes.reduce((sum, s) => sum + s.durationSeconds, 0)).toBeCloseTo(total, 9);
  });

  it("uses more scenes than shots when the shot list is too short for the pacing target, still starting on the hook", () => {
    const scenes = buildScenePlan(["hook", "explain"], total, narration());
    expect(scenes.length).toBeGreaterThan(2);
    expect(scenes[0]!.kind).toBe("hook");
  });

  it("lands cuts on phrase starts (pauses in the narration) when one is near the ideal spacing", () => {
    const words = narration();
    const phraseStarts = new Set(words.filter((_, i) => i > 0 && i % 6 === 0).map((w) => w.startSeconds.toFixed(3)));
    const scenes = buildScenePlan(["a", "b", "c", "d", "e", "f"], total, words);
    let elapsed = 0;
    let snapped = 0;
    for (const s of scenes.slice(0, -1)) {
      elapsed += s.durationSeconds;
      if (phraseStarts.has(elapsed.toFixed(3))) snapped++;
    }
    expect(snapped).toBeGreaterThan(0);
  });

  it("is deterministic and falls back to an even split when given no word timing", () => {
    expect(buildScenePlan(["a", "b", "c"], 30, narration())).toEqual(buildScenePlan(["a", "b", "c"], 30, narration()));
    expect(buildScenePlan(["a", "b", "c"], 30, []).map((s) => s.durationSeconds)).toEqual([10, 10, 10]);
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
    expect(cues[0]!.label).toBe("FILLBOOK · EXAMPLE DATA");
    expect(cues[1]!.label).toBe("TRY FILLBOOK");
    expect(cues[0]!.startSeconds).toBe(4);
    expect(cues[0]!.endSeconds).toBe(8);
    expect(cues[1]!.startSeconds).toBe(8);
    expect(cues[1]!.endSeconds).toBe(12);
  });
});

describe("selectBestThumbnailSeconds", () => {
  const scene = (overrides: Partial<Scene>): Scene => ({
    kind: "explanation",
    label: "",
    durationSeconds: 10,
    backgroundColor: "0x000000",
    ...overrides,
  });

  it("falls back to the given fallback when no scene has real stock footage", () => {
    const scenes = [scene({ kind: "hook" }), scene({ kind: "product" })];
    expect(selectBestThumbnailSeconds(scenes, 3)).toBe(3);
    expect(selectBestThumbnailSeconds(scenes, null)).toBeNull();
  });

  it("prefers a non-hook scene with real footage over the hook scene, even when the hook also has footage", () => {
    const scenes = [
      scene({ kind: "hook", clipPath: "/clips/hook.mp4" }),
      scene({ kind: "product", clipPath: "/clips/product.mp4" }),
    ];
    // scene 1 (product) spans seconds 10-20 -> midpoint 15
    expect(selectBestThumbnailSeconds(scenes, 999)).toBe(15);
  });

  it("uses the hook scene's midpoint when it's the only one with real footage", () => {
    const scenes = [scene({ kind: "hook", clipPath: "/clips/hook.mp4" }), scene({ kind: "product" })];
    // scene 0 (hook) spans seconds 0-10 -> midpoint 5
    expect(selectBestThumbnailSeconds(scenes, 999)).toBe(5);
  });
});
