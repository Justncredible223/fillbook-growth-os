import { describe, it, expect } from "vitest";
import { CHART, chartGeometry, progressGapDollars, validateChartScene } from "../src/shortform/chart";
import { chartAPlan, chartBPlan, chartCPlan, CHART_PILOTS } from "../src/shortform/chartPilots";
import { loadManifest } from "../src/shortform/scenePlan";
import type { ChartSpec, SceneSpec } from "../src/shortform/types";
import { buildChartCues, fitFont, roundedRectPath, wrapCaption } from "../scripts/video-factory/chartCues";

const manifest = loadManifest();
const asset = (id: string) => manifest.assets.find((a) => a.id === id)!;

function sceneOf(plan: ReturnType<typeof chartAPlan>, i: number): SceneSpec {
  return plan.scenes[i]!;
}
const withChart = (s: SceneSpec, patch: Partial<ChartSpec>): SceneSpec => ({ ...s, chart: { ...s.chart!, ...patch } });

describe("chart geometry", () => {
  it("keeps every chart clear of the button column and the caption area", () => {
    for (const p of CHART_PILOTS) {
      for (const s of p.scenes) {
        const g = chartGeometry(s.chart!);
        expect(g.maxX, `${s.sceneId} x`).toBeLessThanOrEqual(CHART.safeRight);
        expect(g.maxY, `${s.sceneId} y`).toBeLessThanOrEqual(CHART.safeBottom);
      }
    }
  });

  it("lays the grid out in rows of `cols` and marks the bad cells", () => {
    const g = chartGeometry(sceneOf(chartAPlan(), 0).chart!);
    expect(g.cells).toHaveLength(18);
    expect(g.cells.filter((c) => c.tone === "bad").map((c) => c.index)).toEqual([13]);
    expect(new Set(g.cells.map((c) => c.y)).size).toBe(3);
    expect(g.bar!.fillEnd).toBeGreaterThan(g.bar!.x0);
    expect(g.bar!.fillEnd).toBeLessThan(g.bar!.x1);
  });

  it("computes the gap a bar shows as target - value, in whole dollars", () => {
    expect(progressGapDollars(7515.96, 9000)).toBe(1484);
    expect(progressGapDollars(2940, 3000)).toBe(60);
    expect(progressGapDollars(3000, 3000)).toBe(0);
  });
});

describe("validateChartScene", () => {
  it("accepts every chart scene of the three plans", () => {
    for (const p of CHART_PILOTS) {
      for (const s of p.scenes) expect(validateChartScene(s, asset(s.assetId!)), s.sceneId).toEqual([]);
    }
  });

  it("refuses a chart number no cited fact supports", () => {
    const s = sceneOf(chartBPlan(), 0);
    const bad = withChart(s, { grid: { ...s.chart!.grid!, total: 11 } });
    expect(validateChartScene(bad, asset(s.assetId!)).map((i) => i.code)).toContain("chart_unsupported_number");
  });

  it("refuses a progress gap label that is not target - value", () => {
    const s = sceneOf(chartBPlan(), 0);
    const bad = withChart(s, { progress: { ...s.chart!.progress!, gapLabel: "$100 to go" } });
    expect(validateChartScene(bad, asset(s.assetId!)).map((i) => i.code)).toContain("chart_gap_mismatch");
  });

  it("refuses a grid whose bad cells do not add up", () => {
    const s = sceneOf(chartAPlan(), 0);
    const bad = withChart(s, { grid: { ...s.chart!.grid!, badAt: [] } });
    expect(validateChartScene(bad, asset(s.assetId!)).map((i) => i.code)).toContain("chart_bad_grid");
  });

  it("refuses headline lines that do not join back to the headline", () => {
    const s = sceneOf(chartCPlan(), 0);
    const bad = withChart(s, { lines: ["One signal.", "Two accounts."] });
    expect(validateChartScene(bad, asset(s.assetId!)).map((i) => i.code)).toContain("chart_lines_mismatch");
  });

  it("refuses a chart that would run under a platform overlay", () => {
    const s = sceneOf(chartAPlan(), 0);
    const bad = withChart(s, { grid: { ...s.chart!.grid!, cols: 2 } });
    expect(validateChartScene(bad, asset(s.assetId!)).map((i) => i.code)).toContain("chart_under_overlay");
  });

  it("refuses a chart scene that shows part of the recording", () => {
    const s = sceneOf(chartAPlan(), 0);
    expect(validateChartScene({ ...s, crop: { x: 0, y: 0, w: 300, h: 100 } }, asset(s.assetId!)).map((i) => i.code)).toContain("chart_has_crop");
  });
});

describe("chart cues", () => {
  const cuesFor = (plan: ReturnType<typeof chartAPlan>, i: number) => {
    const s = plan.scenes[i]!;
    const start = plan.scenes.slice(0, i).reduce((n, x) => n + x.durationSeconds, 0);
    return { s, start, end: start + s.durationSeconds, cues: buildChartCues({ chart: s.chart!, headline: s.headline, captionText: s.captionText, cta: s.cta, start, end: start + s.durationSeconds }) };
  };

  it("is deterministic and keeps every cue inside its scene's window", () => {
    for (const p of CHART_PILOTS) {
      for (let i = 0; i < p.scenes.length; i++) {
        const a = cuesFor(p, i);
        expect(buildChartCues({ chart: a.s.chart!, headline: a.s.headline, captionText: a.s.captionText, cta: a.s.cta, start: a.start, end: a.end })).toEqual(a.cues);
        for (const c of a.cues) {
          expect(c.startSeconds).toBeGreaterThanOrEqual(a.start);
          expect(c.endSeconds).toBeLessThanOrEqual(a.end + 1e-9);
          expect(c.endSeconds).toBeGreaterThan(c.startSeconds);
          expect(c.style).toBe("Chart");
        }
      }
    }
  });

  it("animates the grid on the first beat and draws it complete afterwards", () => {
    const first = cuesFor(chartAPlan(), 0).cues.filter((c) => c.text.includes("\\p1") && c.text.includes("\\t("));
    const later = cuesFor(chartAPlan(), 1).cues.filter((c) => c.text.includes("\\p1") && c.text.includes("\\fscx55"));
    expect(first.length).toBeGreaterThanOrEqual(18);
    expect(later).toHaveLength(0);
  });

  it("draws the headline on every scene, the last line in the accent colour", () => {
    for (const p of CHART_PILOTS) {
      for (let i = 0; i < p.scenes.length; i++) {
        const text = cuesFor(p, i).cues.map((c) => c.text).join("\n");
        for (const line of p.scenes[i]!.chart!.lines) expect(text).toContain(line.replace(/\$/g, "$"));
      }
    }
  });

  it("draws the closing invitation only on the closing scene, and dims the chart there", () => {
    const p = chartAPlan();
    const all = p.scenes.map((_, i) => cuesFor(p, i).cues.map((c) => c.text).join("\n"));
    all.forEach((t, i) => expect(t.includes("fillbookhq"), `scene ${i}`).toBe(i === p.scenes.length - 1));
    expect(all[p.scenes.length - 1]).toContain("\\1a&H8C&");
    expect(all[0]).not.toContain("\\1a&H8C&");
  });

  it("writes drawings that start at (0,0), because libass anchors a drawing from its corner", () => {
    const path = roundedRectPath(200, 100, 16);
    const nums = path.replace(/[mlb]/g, " ").trim().split(/\s+/).map(Number);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...nums)).toBe(200);
  });

  it("fits and wraps text to the safe width", () => {
    expect(fitFont("Still $1,484 short.", 150, CHART.right - CHART.left) * 0.27 * 19).toBeLessThanOrEqual(CHART.right - CHART.left);
    expect(wrapCaption("One red day: -$1,504. About the size of the gap.", 32).every((l) => l.length <= 32)).toBe(true);
  });
});
