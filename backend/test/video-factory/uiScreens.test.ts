import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignUiScreens, copyUiScreenToDir, seedFromId, UI_SCREENS } from "../../scripts/video-factory/uiScreens";
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
    const scenes = [scene("product", "Fillbook UI: importing trades from your broker"), scene("product", "Fillbook UI: the calendar view")];
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
      ["Fillbook UI: the revenge trade flagged as oversized", "trade-log-revenge.jpg"],
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

  it("no longer offers the retired screens whose figures contradicted the new ones", () => {
    const files = UI_SCREENS.map((s) => s.file);
    expect(files).not.toContain("leaks-edge.jpg");
    expect(files).not.toContain("daily-brief.jpg");
    expect(files).toHaveLength(11);
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
});
