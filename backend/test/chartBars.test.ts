import { describe, it, expect } from "vitest";
import { CHART, barsPitch, chartGeometry, validateChartScene } from "../src/shortform/chart";
import { BARS_PILOTS } from "../src/shortform/chartBarsConcepts";
import { MOTION_SCENE_PLANS, isChartPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar } from "../src/shortform/storyScore";
import { findRepeatedHook } from "../src/content/videoHookVariety";
import { OriginalityEngine } from "../src/content/originalityEngine";
import { offeredChartConcepts } from "../src/video/dailyChartCardRequests";
import { buildChartCues } from "../scripts/video-factory/chartCues";
import type { ChartSpec, SceneSpec } from "../src/shortform/types";

const manifest = loadManifest();
const asset = (id: string) => manifest.assets.find((a) => a.id === id)!;
const withChart = (s: SceneSpec, patch: Partial<ChartSpec>): SceneSpec => ({ ...s, chart: { ...s.chart!, ...patch } });
const spoken = (p: { scenes: SceneSpec[] }) => p.scenes.map((s) => s.narration).join(" ");

describe("bar-chart concepts", () => {
  it("are all valid plans that clear the render bar, with no errors", () => {
    expect(BARS_PILOTS.length).toBeGreaterThanOrEqual(9);
    for (const p of BARS_PILOTS) {
      const v = validateScenePlan(p, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error"), p.planId).toEqual([]);
      expect(renderBar(p).ok, p.planId).toBe(true);
      expect(isChartPlan(p)).toBe(true);
      expect(MOTION_SCENE_PLANS).toContain(p);
    }
  });

  it("each cover a different part of the product", () => {
    const topics = BARS_PILOTS.map((p) => p.scenes[0]!.expectedTopics[0]);
    expect(new Set(topics).size).toBe(topics.length);
    expect(new Set(BARS_PILOTS.map((p) => `${p.scenes[0]!.assetId}/${p.scenes[0]!.expectedTopics[0]}`)).size).toBe(BARS_PILOTS.length);
  });

  it("do not repeat each other's hooks or wording, nor the other hand-made chart cards'", () => {
    const engine = new OriginalityEngine();
    const others = MOTION_SCENE_PLANS.filter((p) => isChartPlan(p) && !p.planId.startsWith("chart-o-"));
    for (const p of BARS_PILOTS) {
      const rest = others.filter((o) => o !== p);
      expect(findRepeatedHook(p.hook, rest.map((o) => o.hook)), p.planId).toBeNull();
      const sims = engine.compareAgainstRecent(spoken(p), rest.map(spoken));
      expect(sims[0]?.similarity ?? 0, p.planId).toBeLessThan(0.6);
    }
  });

  it("say where in Fillbook the feature lives, and never end a line on an engagement-bait question", () => {
    // The AI review (growth_strategist) failed a concept that showed numbers with no mechanism: it must name the product and the screen.
    for (const p of BARS_PILOTS) {
      const opening = p.scenes[0]!;
      expect(`${opening.narration} ${opening.captionText}`, `${p.planId} opening`).toMatch(/fillbook|reports|insights|progress|plan|account health/i);
      expect(spoken(p), `${p.planId}`).toMatch(/\bFillbook\b/);
      for (const s of p.scenes) expect(s.narration.trim().endsWith("?"), `${s.sceneId} ends on a question`).toBe(p.planId === "chart-bars-conviction" && s === opening);
    }
  });

  it("keep every chart inside the platforms' safe area, including the closing beat", () => {
    for (const p of BARS_PILOTS) {
      for (const s of p.scenes) {
        const g = chartGeometry(s.chart!);
        expect(g.maxX, s.sceneId).toBeLessThanOrEqual(CHART.safeRight);
        expect(g.maxY, s.sceneId).toBeLessThanOrEqual(CHART.safeBottom);
        expect(g.rowBars).toHaveLength(s.chart!.rows!.length);
      }
    }
  });

  it("size each bar against the largest row", () => {
    const g = chartGeometry(BARS_PILOTS[0]!.scenes[0]!.chart!);
    const lengths = g.rowBars.map((b) => b.x1 - b.x0);
    expect(Math.max(...lengths)).toBe(CHART.barsBarLength);
    expect(lengths[0]!).toBeLessThan(lengths[1]!); // Monday's $57.32 is shorter than Tuesday's $157.12
  });

  it("tighten the row pitch as rows are added", () => {
    expect(barsPitch(2)).toBeGreaterThanOrEqual(barsPitch(4));
    expect(barsPitch(4)).toBeGreaterThan(barsPitch(5));
  });
});

describe("validateChartScene for bars", () => {
  const plan = BARS_PILOTS.find((p) => p.planId === "chart-bars-day-of-week")!;
  const scene = plan.scenes[2]!;
  const rows = scene.chart!.rows!;
  const codes = (s: SceneSpec) => validateChartScene(s, asset(s.assetId!)).map((i) => i.code);

  it("accepts the real scene", () => expect(codes(scene)).toEqual([]));

  it("refuses a figure no cited fact supports", () => {
    const bad = withChart(scene, { rows: [{ ...rows[0]!, display: "-$99.99", amount: 99.99 }, ...rows.slice(1)] });
    expect(codes(bad)).toContain("chart_unsupported_number");
  });

  it("refuses a bar whose figure and amount disagree", () => {
    const bad = withChart(scene, { rows: [{ ...rows[0]!, amount: 70 }, ...rows.slice(1)] });
    expect(codes(bad)).toContain("chart_row_display_mismatch");
  });

  it("refuses a negative figure drawn as a good bar", () => {
    const bad = withChart(scene, { rows: [{ ...rows[0]!, tone: "good" }, ...rows.slice(1)] });
    expect(codes(bad)).toContain("chart_row_tone");
  });

  it("refuses a chart with too few or too many rows, or a highlight that is not a row", () => {
    expect(codes(withChart(scene, { rows: rows.slice(0, 1) }))).toContain("chart_bad_rows");
    expect(codes(withChart(scene, { rows: [...rows, rows[0]!] }))).toContain("chart_bad_rows");
    expect(codes(withChart(scene, { highlight: 9 }))).toContain("chart_bad_highlight");
  });
});

describe("bars drawing", () => {
  const s = BARS_PILOTS.find((p) => p.planId === "chart-bars-sized-up")!.scenes;
  const cues = (i: number) => buildChartCues({ chart: s[i]!.chart!, headline: s[i]!.headline, captionText: s[i]!.captionText, cta: s[i]!.cta, start: 0, end: s[i]!.durationSeconds });

  it("draws every row's label and figure, and animates them in on the first beat only", () => {
    for (const row of s[0]!.chart!.rows!) {
      expect(cues(0).some((c) => c.text.includes(row.display))).toBe(true);
      expect(cues(0).some((c) => c.text.includes(row.label))).toBe(true);
    }
    expect(cues(0).some((c) => c.text.includes("\\clip(") && c.text.includes("\\t("))).toBe(true);
    expect(cues(1).some((c) => c.text.includes("\\clip("))).toBe(false);
  });

  it("rings the highlighted row on the third beat only", () => {
    const rings = (i: number) => cues(i).filter((c) => c.text.includes("\\bord6")).length;
    expect(rings(2)).toBe(3);
    expect(rings(0) + rings(1) + rings(3)).toBe(0);
  });
});

describe("the daily queue", () => {
  it("serves different themes first, so the win-rate template does not run back to back", () => {
    const byId = new Map(MOTION_SCENE_PLANS.map((p) => [p.planId, p] as const));
    const order = offeredChartConcepts().map((c) => byId.get(c.id)!.scenes[0]!.expectedTopics[0]);
    const firstRound = order.slice(0, new Set(order).size);
    expect(new Set(firstRound).size).toBe(firstRound.length);
    expect(order.slice(0, 10).filter((t) => t === "trading_math").length).toBeLessThanOrEqual(1);
    for (let i = 1; i < firstRound.length; i++) expect(firstRound[i]).not.toBe(firstRound[i - 1]);
  });
});
