import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHART, validateChartScene } from "../src/shortform/chart";
import { MOCK_BOXES, MOCK_RIGHT_LIMIT, MOCK_SAFE, boxesOutsideSafeArea } from "../src/shortform/mockLayout";
import { PLATFORM_OVERLAY_ZONES } from "../scripts/video-factory/render";
import { barsSizedUpPlan } from "../src/shortform/chartBarsConcepts";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar } from "../src/shortform/storyScore";
import { buildMockHtml, createMockRenderer, measuredProblems } from "../scripts/video-factory/mockCard";
import type { SceneSpec } from "../src/shortform/types";

const manifest = loadManifest();
const plan = barsSizedUpPlan();
const frame = (s: SceneSpec) => ({ chart: s.chart!, headline: s.headline, captionText: s.captionText, cta: s.cta });

describe("mock slide layout keeps clear of TikTok and YouTube Shorts overlays", () => {
  it("every box sits inside the safe rectangle, which stops at the chart cards' own right edge", () => {
    expect(MOCK_RIGHT_LIMIT).toBe(CHART.safeRight);
    expect(boxesOutsideSafeArea()).toEqual([]);
    for (const [name, b] of Object.entries(MOCK_BOXES)) {
      expect(b.x + b.w, name).toBeLessThanOrEqual(880);
      expect(b.y + b.h, name).toBeLessThanOrEqual(1600);
      expect(b.y, name).toBeGreaterThanOrEqual(150);
    }
  });

  it("clears the measured platform overlay zones (button column from x=930 down from y=740, caption block from y=1600)", () => {
    const { rightColumn, captionTop } = PLATFORM_OVERLAY_ZONES;
    for (const [name, b] of Object.entries(MOCK_BOXES)) {
      expect(b.x + b.w, name).toBeLessThanOrEqual(rightColumn.x);
      expect(b.y + b.h, name).toBeLessThanOrEqual(captionTop);
    }
  });

  it("the sized-up concept is a valid mock plan that clears the render bar", () => {
    expect(plan.scenes.every((s) => s.chart?.kind === "mock")).toBe(true);
    const v = validateScenePlan(plan, manifest, { checkFiles: true });
    expect(v.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(renderBar(plan).ok).toBe(true);
  });

  it("refuses text too long for its box, a number the facts do not support, and a wrong meter mark", () => {
    const s = plan.scenes[1]!;
    const run = (patch: object, extra: Partial<SceneSpec> = {}) =>
      validateChartScene({ ...s, ...extra, chart: { ...s.chart!, mock: { ...s.chart!.mock!, ...patch } } }, manifest.assets.find((a) => a.id === s.assetId)!).map((i) => i.code);
    expect(run({ eyebrow: "A SAMPLE ACCOUNT WITH A VERY LONG NAME" })).toContain("chart_mock_text_too_long");
    expect(run({ step: "FILLBOOK INSIGHTS 99" })).toContain("chart_unsupported_number");
    const m = s.chart!.mock!;
    expect(run({ result: { ...m.result, stats: [m.result.stats[0], { ...m.result.stats[1]!, meter: { markAt: 0.9 } }] } })).toContain("chart_mock_meter_mismatch");
    expect(run({ result: { ...m.result, tag: "Sample" } })).toContain("chart_mock_missing_demo_tag");
  });

  it("measured boxes past the right limit or the bottom are reported", () => {
    const ok = { box: "x", x: 100, y: 200, w: 500, h: 100, overflowX: 0, overflowY: 0, fit: true };
    expect(measuredProblems([ok])).toEqual([]);
    expect(measuredProblems([{ ...ok, w: 800 }]).join()).toMatch(/outside the clear area/);
    expect(measuredProblems([{ ...ok, y: 1500, h: 120 }]).join()).toMatch(/outside the clear area/);
    expect(measuredProblems([{ ...ok, overflowY: 12 }]).join()).toMatch(/overflows/);
  });

  it("the HTML shows the result and highlight only from the beat that reveals them", () => {
    const [b1, , b3] = plan.scenes;
    expect(buildMockHtml(frame(b1!))).toMatch(/class="step hidden"/);
    expect(buildMockHtml(frame(b3!))).toMatch(/class="stat hl"/);
  });

  const chromium = ["/opt/pw-browsers/chromium", process.env.MOCK_CHROMIUM_PATH ?? ""].some((p) => p && existsSync(p));
  it.skipIf(!chromium)("renders every beat in the brand fonts with all boxes measured clear of the overlays", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mock-"));
    const r = await createMockRenderer(dir);
    try {
      for (const [i, s] of plan.scenes.entries()) expect(existsSync(await r.render(frame(s), join(dir, `m${i}.png`)))).toBe(true);
    } finally {
      await r.close();
    }
  }, 60_000);
});
