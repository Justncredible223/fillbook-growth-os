import { describe, it, expect } from "vitest";
import { OUTCOMES_PARAMS, OUTCOMES_PILOTS, outcomesPlan, spreadLosses } from "../src/shortform/chartConcepts";
import { CHART, ILLUSTRATIVE_LABEL, chartGeometry, illustrationFigures, textBlockBottom, validateIllustrativeChart } from "../src/shortform/chart";
import { MOTION_SCENE_PLANS, isChartPlan, isPayoffPlan } from "../src/shortform/motionPlans";
import { loadManifest, validateScenePlan } from "../src/shortform/scenePlan";
import { renderBar, scoreStory } from "../src/shortform/storyScore";
import type { ChartSpec, SceneSpec } from "../src/shortform/types";
import { buildChartCues } from "../scripts/video-factory/chartCues";

const manifest = loadManifest();
const first = (): SceneSpec => OUTCOMES_PILOTS[0]!.scenes[2]!;
const withChart = (s: SceneSpec, patch: Partial<ChartSpec>): SceneSpec => ({ ...s, chart: { ...s.chart!, ...patch } });
const codes = (s: SceneSpec) => validateIllustrativeChart(s).map((i) => i.code);

describe("illustrative outcomes concepts", () => {
  it("are twelve concepts, each an A+ that clears the render bar and passes full validation", () => {
    expect(OUTCOMES_PILOTS).toHaveLength(12);
    for (const p of OUTCOMES_PILOTS) {
      expect(scoreStory(p).grade, p.planId).toBe("A+");
      expect(renderBar(p).ok).toBe(true);
      const v = validateScenePlan(p, manifest, { checkFiles: true });
      expect(v.issues.filter((i) => i.severity === "error"), p.planId).toEqual([]);
    }
  });

  it("are in the catalog once each with unique ids and titles, silent, and use the chart render settings", () => {
    const titles = MOTION_SCENE_PLANS.map((p) => p.title.toLowerCase());
    expect(new Set(OUTCOMES_PILOTS.map((p) => p.planId)).size).toBe(12);
    for (const p of OUTCOMES_PILOTS) {
      expect(MOTION_SCENE_PLANS.filter((x) => x.planId === p.planId)).toHaveLength(1);
      expect(titles.filter((t) => t === p.title.toLowerCase())).toHaveLength(1);
      expect(isChartPlan(p) && isPayoffPlan(p)).toBe(true);
      expect(p.voiceover).toBe("none");
    }
  });

  it("never claim to be a real account: every scene is labelled as an illustrative example, with no recording behind it", () => {
    for (const p of OUTCOMES_PILOTS) {
      for (const s of p.scenes) {
        expect(s.assetId).toBeNull();
        expect(s.disclosure).toBe(ILLUSTRATIVE_LABEL);
        expect(`${s.narration} ${s.headline} ${s.captionText}`).not.toMatch(/demo|your account'?s? data|real account/i);
      }
    }
  });

  it("show a mix of paradoxes: a high win rate that loses and a low one that wins", () => {
    const nets = OUTCOMES_PARAMS.map((p) => illustrationFigures(p).net);
    expect(nets.some((n) => n < 0)).toBe(true);
    expect(nets.some((n) => n > 0)).toBe(true);
    expect(nets.every((n) => n !== 0)).toBe(true);
    for (const p of OUTCOMES_PARAMS) expect(Number.isInteger(illustrationFigures(p).winRate)).toBe(true);
  });

  it("compute 11 of 20 as exactly 55%, not 55.00000000000001", () => {
    expect(illustrationFigures({ trades: 20, wins: 11, avgWin: 100, avgLoss: 250 }).winRate).toBe(55);
  });

  it("spread the losses through the trades, never in a run", () => {
    for (const [trades, losses] of [[10, 3], [20, 8], [10, 5], [20, 4]] as const) {
      const at = spreadLosses(trades, losses);
      expect(new Set(at).size).toBe(losses);
      expect(Math.max(...at)).toBeLessThan(trades);
    }
    expect(spreadLosses(10, 3)).toEqual([1, 5, 8]);
  });

  it("keep the whole chart and the closing invitation clear of the platform overlays", () => {
    for (const p of OUTCOMES_PILOTS) {
      for (const s of p.scenes) {
        const g = chartGeometry(s.chart!);
        expect(g.maxX).toBeLessThanOrEqual(CHART.safeRight);
        expect(g.maxY).toBeLessThanOrEqual(CHART.safeBottom);
        expect(textBlockBottom(s, g.captionTop), `${s.sceneId} text block`).toBeLessThanOrEqual(CHART.safeBottom);
      }
    }
  });
});

describe("validateIllustrativeChart refuses a card the arithmetic does not support", () => {
  it("accepts the untouched scene", () => expect(codes(first())).toEqual([]));

  it("refuses a net that is not wins minus losses", () => {
    expect(codes(withChart(first(), { net: { display: "-$1,000", tone: "bad" } }))).toContain("chart_net_mismatch");
  });

  it("refuses a net of the wrong sign or colour", () => {
    expect(codes(withChart(first(), { net: { display: "+$2,000", tone: "bad" } }))).toEqual(expect.arrayContaining(["chart_net_sign"]));
    expect(codes(withChart(first(), { net: { display: "-$2,000", tone: "good" } }))).toContain("chart_net_tone");
  });

  it("refuses a bar whose amount is not trades x average", () => {
    const s = first();
    expect(codes(withChart(s, { bars: [{ ...s.chart!.bars![0], amount: 800, display: "+$800" }, s.chart!.bars![1]] }))).toContain("chart_bar_mismatch");
  });

  it("refuses a bar whose label figure differs from its amount", () => {
    const s = first();
    expect(codes(withChart(s, { bars: [{ ...s.chart!.bars![0], display: "+$900" }, s.chart!.bars![1]] }))).toContain("chart_bar_display_mismatch");
  });

  it("refuses a grid that does not match the trade counts", () => {
    const s = first();
    expect(codes(withChart(s, { grid: { ...s.chart!.grid!, badAt: [1, 5] } }))).toContain("chart_bad_grid");
  });

  it("refuses text that shows a number the arithmetic does not produce", () => {
    expect(codes({ ...first(), captionText: "Up 99% on the year." })).toContain("chart_unsupported_number");
    expect(codes({ ...first(), narration: "But the net was a loss of $2,500." })).toContain("chart_unsupported_number");
  });

  it("refuses a scene without the illustrative label", () => {
    expect(codes({ ...first(), disclosure: "Demo data" })).toContain("missing_illustrative_label");
  });

  it("refuses counts whose win rate is not a whole percent, and a zero net", () => {
    const plan = outcomesPlan({ trades: 7, wins: 3, avgWin: 100, avgLoss: 100 });
    expect(plan.scenes.flatMap((s) => validateIllustrativeChart(s)).map((i) => i.code)).toContain("chart_win_rate_not_whole");
    const zero = outcomesPlan({ trades: 10, wins: 5, avgWin: 100, avgLoss: 100 });
    expect(zero.scenes.flatMap((s) => validateIllustrativeChart(s)).map((i) => i.code)).toContain("chart_no_paradox");
  });

  it("refuses a closing block that would run into the platform caption area", () => {
    const closing = OUTCOMES_PILOTS[0]!.scenes[3]!;
    expect(codes({ ...closing, captionText: "Check your average loss and your average win and your size every single day." })).toContain("chart_text_under_overlay");
  });
});

describe("outcomes chart cues", () => {
  it("draw the bars from the second beat and the net from the third, with the chart dimmed when closing", () => {
    const [s1, s2, s3, s4] = OUTCOMES_PILOTS[0]!.scenes;
    const cuesText = (s: SceneSpec) => buildChartCues({ chart: s.chart!, headline: s.headline, captionText: s.captionText, cta: s.cta, start: 0, end: s.durationSeconds }).map((c) => c.text).join("\n");
    expect(cuesText(s1!)).not.toContain("+$700");
    expect(cuesText(s2!)).toContain("+$700");
    expect(cuesText(s2!)).toContain("-$2,700");
    expect(cuesText(s2!)).not.toContain("-$2,000");
    expect(cuesText(s3!)).toContain("-$2,000");
    expect(cuesText(s4!)).toContain("\\1a&H8C&");
    expect(cuesText(s4!)).toContain("fillbookhq");
  });
});
