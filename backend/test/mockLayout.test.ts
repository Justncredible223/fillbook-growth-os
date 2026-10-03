import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHART, validateChartScene } from "../src/shortform/chart";
import { MOCK_BOXES, MOCK_RIGHT_LIMIT, MOCK_SAFE, boxesOutsideSafeArea } from "../src/shortform/mockLayout";
import { PLATFORM_OVERLAY_ZONES, buildFfmpegArgs } from "../scripts/video-factory/render";
import { BARS_PILOTS, barsSizedUpPlan } from "../src/shortform/chartBarsConcepts";
import { MOCK_CARD_PILOTS } from "../src/shortform/chartMockConcepts";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar } from "../src/shortform/storyScore";
import { MOCK_ENTRANCE, buildMockHtml, chromiumAvailable, createMockRenderer, measuredProblems } from "../scripts/video-factory/mockCard";
import type { SceneSpec } from "../src/shortform/types";

const manifest = loadManifest();
const chromium = await chromiumAvailable();
const plan = barsSizedUpPlan();
const frame = (s: SceneSpec) => ({ chart: s.chart!, headline: s.headline, captionText: s.captionText, cta: s.cta });

describe("mock slide layout keeps clear of TikTok and YouTube Shorts overlays", () => {
  it("every box sits inside the safe rectangle, which stops at the chart cards' own right edge", () => {
    expect(MOCK_RIGHT_LIMIT).toBe(CHART.safeRight);
    expect(boxesOutsideSafeArea()).toEqual([]);
    for (const [name, b] of Object.entries(MOCK_BOXES)) {
      expect(b.x + b.w, name).toBeLessThanOrEqual(880);
      expect(b.y + b.h, name).toBeLessThanOrEqual(1250); // above TikTok's pinned-comment bubble (from about y=1290)
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

  it("the opening beat's headline figures count up, and later beats animate what they reveal", () => {
    const [b1, b2, b3, b4, b5] = plan.scenes.map((s) => buildMockHtml(frame(s)));
    expect(b1).toMatch(/data-count="\$127"/);
    expect(b1).toMatch(/data-a="slideup"/);
    expect(b2).toMatch(/class="v" data-count="5"/);
    expect(b3).toMatch(/data-a="pop"/);
    expect(b4).toMatch(/class="win d"[^>]*data-a="slideup"/);
    expect(b5).toMatch(/data-a="dimin"/);
    expect(b1).not.toMatch(/data-count="\$127"[^>]*>\$0/); // markup holds the finished text; the page script draws the count
  });

  it("a scene with entrance frames is read as an image sequence and held on its last frame", () => {
    const scene = (i: number) => ({ kind: "explanation" as const, label: "", durationSeconds: 3, backgroundColor: "0x05070a", narration: "", card: { backgroundPath: `/x/mock-${i}.png`, frames: { pattern: `mock-${i}-%03d.png`, count: 30 } } });
    const args = buildFfmpegArgs({ scenes: [scene(0), scene(1)], totalDurationSeconds: 6, voiceoverPath: "/x/v.mp3", assPath: "/x/c.ass", outputPath: "/x/o.mp4", silencePadSeconds: 0.3 }).join(" ");
    expect(args).toContain("mock-0-%03d.png");
    expect(args).not.toContain("-loop 1 -framerate 30 -t 3.000 -i mock-0");
    expect(args).toMatch(/tpad=stop_mode=clone/);
  });

  it.skipIf(!chromium)("renders every beat of every concept in the brand fonts with all boxes measured clear of the overlays", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mock-"));
    const r = await createMockRenderer(dir);
    try {
      for (const p of [...BARS_PILOTS, ...MOCK_CARD_PILOTS]) {
        for (const [i, s] of p.scenes.entries()) expect(existsSync(await r.render(frame(s), join(dir, `${p.planId}-${i}.png`))), `${p.planId} beat ${i + 1}`).toBe(true);
      }
    } finally {
      await r.close();
    }
  }, 120_000);

  it.skipIf(!chromium)("writes an entrance sequence that ends on the finished slide", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mock-seq-"));
    const r = await createMockRenderer(dir);
    try {
      const beat = await r.renderBeat(frame(plan.scenes[0]!), dir, "b0");
      expect(beat.count).toBe(Math.round(MOCK_ENTRANCE.seconds * MOCK_ENTRANCE.fps));
      expect(existsSync(join(dir, "b0-000.png"))).toBe(true);
      expect(existsSync(join(dir, `b0-${String(beat.count - 1).padStart(3, "0")}.png`))).toBe(true);
      expect(existsSync(beat.stillPath)).toBe(true);
    } finally {
      await r.close();
    }
  }, 60_000);
});
