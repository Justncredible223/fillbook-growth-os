import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignHookFallbackScreen, assignUiScreens, copyUiScreenToDir, seedFromId, UI_SCREENS } from "../../scripts/video-factory/uiScreens";
import type { Scene } from "../../scripts/video-factory/types";

const scene = (kind: Scene["kind"], shot: string): Scene => ({ kind, label: "", durationSeconds: 3, backgroundColor: "0x0d1420", shot });

describe("UI screens", () => {
  it("every registered screenshot exists in the bundled assets", () => {
    for (const s of UI_SCREENS) {
      const [scene0] = [scene("product", s.keywords[0]!)];
      assignUiScreens([scene0], 0);
      expect(existsSync(scene0.imagePath!)).toBe(true);
    }
  });

  it("only assigns screens to product scenes", () => {
    const scenes = [scene("hook", "hook"), scene("explanation", "talking"), scene("metric", "a number"), scene("product", "Fillbook UI")];
    assignUiScreens(scenes, 0);
    expect(scenes.map((s) => Boolean(s.imagePath))).toEqual([false, false, false, true]);
  });

  it("matches a screen to keywords in the shot description", () => {
    const scenes = [scene("product", "Fillbook UI: importing trades into your journal"), scene("product", "Fillbook UI: the calendar view")];
    assignUiScreens(scenes, 0);
    expect(scenes[0]!.imagePath).toContain("connect-source.jpg");
    expect(scenes[1]!.imagePath).toContain("calendar.jpg");
  });

  it("does not reuse a screen across scenes until all are used, and stays deterministic", () => {
    const make = () => Array.from({ length: UI_SCREENS.length }, () => scene("product", "Fillbook UI"));
    const a = make();
    const b = make();
    assignUiScreens(a, 7);
    assignUiScreens(b, 7);
    expect(a.map((s) => s.imagePath)).toEqual(b.map((s) => s.imagePath));
    expect(new Set(a.map((s) => s.imagePath)).size).toBe(UI_SCREENS.length);
  });

  it("matches the new screens from their story keywords", () => {
    const cases: Array<[string, string]> = [
      ["Fillbook UI: your biggest leak and strongest edge", "intelligence-overview.jpg"],
      ["Fillbook UI: drawdown buffer nearly gone", "drawdown-bars.jpg"],
      ["Fillbook UI: asking the AI coach what is dragging your win rate down", "ai-coach.jpg"],
      ["Fillbook UI: ask anything, suggested questions", "ai-coach-prompts.jpg"],
    ];
    for (const [shot, file] of cases) {
      const scenes = [scene("product", shot)];
      assignUiScreens(scenes, 0);
      expect(scenes[0]!.imagePath).toContain(file);
    }
  });

  it("a custom topic mentioning revenge/oversized/sizing/trade log no longer surfaces the retired revenge-tagged screenshot", () => {
    // Regression coverage for the 2026-09-27 retirement (see uiScreens.ts's UI_SCREENS comment):
    // these are exactly the words that used to route to trade-log-revenge.jpg by loose keyword
    // match, regardless of whether the shot actually meant that specific flagged trade.
    for (const shot of ["Fillbook UI: the revenge trade flagged as oversized", "Fillbook UI: sizing up after a loss streak", "Fillbook UI: your trade log, overtrading pattern"]) {
      const scenes = [scene("product", shot)];
      assignUiScreens(scenes, 0);
      expect(scenes[0]!.imagePath).not.toContain("trade-log-revenge.jpg");
    }
  });

  it("a generic custom topic that merely mentions ordinary trading words no longer pulls in an unrelated screen by loose keyword similarity", () => {
    // 2026-09-27 audit: every surviving screen's keyword list carried the same risk class as the
    // retired trade-log-revenge.jpg entry -- generic single words ("risk," "account," "profit,"
    // "rules," "review," "best," "market," "score," "limit," "coach," "chart," "week," ...) that
    // almost any custom topic could contain regardless of whether it's actually about that
    // screen's specific feature. None of these shots are about the feature named in parentheses,
    // so none should match it anymore.
    const cases: Array<[string, string]> = [
      ["A trader talks about managing risk on a funded account.", "drawdown-bars.jpg"], // "risk"/"account"/"funded" used to match drawdown
      ["Why most traders never turn a profit.", "charts.jpg"], // "profit" used to match charts
      ["The rules that separate winners from losers.", "edge-score.jpg"], // "rules" used to match edge-score
      ["A review of last week's biggest mistakes.", "weekly-review.jpg"], // "review"/"week" used to match weekly-review
      ["Finding the best setup for your trading style.", "top-markets.jpg"], // "best"/"setup" used to match top-markets
      ["A coach explains how to read a chart.", "ai-coach.jpg"], // "coach"/"chart" used to match ai-coach
    ];
    for (const [shot, unrelatedFile] of cases) {
      const scenes = [scene("product", shot)];
      assignUiScreens(scenes, 0);
      expect(scenes[0]!.imagePath, shot).not.toContain(unrelatedFile);
    }
  });

  it("every UI_SCREENS entry declares a topic tag", () => {
    for (const s of UI_SCREENS) expect(s.topic, s.file).toBeTruthy();
  });

  it("no longer offers the retired screens whose figures contradicted the new ones, or the retired revenge/oversized-framing screen", () => {
    const files = UI_SCREENS.map((s) => s.file);
    expect(files).not.toContain("leaks-edge.jpg");
    expect(files).not.toContain("trade-log-revenge.jpg");
    expect(files).not.toContain("daily-brief.jpg");
    expect(files).toHaveLength(10);
  });

  it("copies a screenshot into the output directory under a ui- prefixed basename", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-test-"));
    try {
      const s = scene("product", "calendar");
      assignUiScreens([s], 0);
      const dest = copyUiScreenToDir(s.imagePath!, dir);
      expect(dest).toBe(join(dir, "ui-calendar.jpg"));
      expect(existsSync(dest)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seedFromId is stable and non-negative", () => {
    expect(seedFromId("draft-1")).toBe(seedFromId("draft-1"));
    expect(seedFromId("draft-1")).toBeGreaterThanOrEqual(0);
  });

  describe("hook fallback (retention-critical: the hook must never be a flat color card)", () => {
    it("gives a hook scene with no imagePath and no clipPath a real screenshot", () => {
      const scenes = [scene("hook", "the hook line")];
      assignHookFallbackScreen(scenes, 0);
      expect(scenes[0]!.imagePath).toBeTruthy();
      expect(existsSync(scenes[0]!.imagePath!)).toBe(true);
    });

    it("never touches a hook scene that already has real stock footage", () => {
      const scenes: Scene[] = [{ ...scene("hook", "the hook line"), clipPath: "/clips/hook.mp4" }];
      assignHookFallbackScreen(scenes, 0);
      expect(scenes[0]!.imagePath).toBeUndefined();
      expect(scenes[0]!.clipPath).toBe("/clips/hook.mp4");
    });

    it("never touches a hook scene that already has a screenshot", () => {
      const scenes: Scene[] = [{ ...scene("hook", "the hook line"), imagePath: "/already/assigned.jpg" }];
      assignHookFallbackScreen(scenes, 0);
      expect(scenes[0]!.imagePath).toBe("/already/assigned.jpg");
    });

    it("never assigns a non-hook scene, even when it also has no imagePath or clipPath", () => {
      const scenes = [scene("hook", "hook"), scene("explanation", "talking"), scene("metric", "a number")];
      assignHookFallbackScreen(scenes, 0);
      expect(scenes.map((s) => Boolean(s.imagePath))).toEqual([true, false, false]);
    });

    it("does not reuse a screen a product scene already used this render", () => {
      const scenes = [scene("product", "Fillbook UI"), scene("hook", "hook")];
      assignUiScreens(scenes, 0);
      const productScreen = scenes[0]!.imagePath;
      assignHookFallbackScreen(scenes, 0);
      expect(scenes[1]!.imagePath).toBeTruthy();
      expect(scenes[1]!.imagePath).not.toBe(productScreen);
    });

    it("is deterministic for a given seed", () => {
      const a = [scene("hook", "hook")];
      const b = [scene("hook", "hook")];
      assignHookFallbackScreen(a, 5);
      assignHookFallbackScreen(b, 5);
      expect(a[0]!.imagePath).toBe(b[0]!.imagePath);
    });
  });
});
