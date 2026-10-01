import { extractNumbers, numberIsSupported, claimEvidenceNumbers } from "./claims.js";
import type { ChartSpec, PlanIssue, SceneSpec, VerifiedAsset } from "./types.js";

/**
 * Chart-card geometry (frame pixels, 1080x1920) and validation. The geometry is pure data so the same numbers drive the
 * renderer (scripts/video-factory/chartCues.ts) and the safe-zone check here. Everything stays left of x=880 (the
 * platforms' button column starts at x=930, y>=740) and above y=1560 (their caption area starts at y=1600).
 */
export const CHART = {
  left: 100,
  right: 880,
  centerX: 490,
  /** Top of the headline block; each line is `lineHeight` below the last. */
  hookTop: 250,
  hookFont: 150,
  hookLineHeight: 150,
  gridTop: 650,
  gridGap: 18,
  gridMaxCell: 100,
  barHeight: 64,
  /** Gap between the grid's bottom and the progress label. */
  barGap: 110,
  pairTop: 760,
  pairRowGap: 170,
  pairBarLength: 640,
  pairBarHeight: 80,
  pairMarkerX: 150,
  safeRight: 880,
  safeBottom: 1560,
} as const;

export interface GridCell {
  index: number;
  x: number;
  y: number;
  size: number;
  tone: "good" | "bad";
}

export interface BarGeometry {
  x0: number;
  x1: number;
  y: number;
  h: number;
  /** x where the filled part ends and the missing part begins. */
  fillEnd: number;
}

export interface ChartGeometry {
  cells: GridCell[];
  bar: BarGeometry | null;
  /** Pair chart: marker line and the two bars, top to bottom. */
  pairBars: Array<{ x0: number; x1: number; y: number; h: number; label: string }>;
  /** Top of the beat caption block, below whichever chart is drawn. */
  captionTop: number;
  /** Lowest and rightmost pixel any chart element reaches. */
  maxX: number;
  maxY: number;
}

export function headlineBottom(lines: number): number {
  return CHART.hookTop + lines * CHART.hookLineHeight;
}

export function chartGeometry(chart: ChartSpec): ChartGeometry {
  const cells: GridCell[] = [];
  let bar: BarGeometry | null = null;
  const pairBars: ChartGeometry["pairBars"] = [];
  let maxX: number = CHART.left;
  let maxY: number = headlineBottom(chart.lines.length);
  let captionTop: number = CHART.gridTop;

  if (chart.kind === "grid_progress" && chart.grid) {
    const { total, cols, badAt } = chart.grid;
    const width = CHART.right - CHART.left;
    const size = Math.min(CHART.gridMaxCell, Math.floor((width - (cols - 1) * CHART.gridGap) / cols));
    const rows = Math.ceil(total / cols);
    const gridW = cols * size + (cols - 1) * CHART.gridGap;
    const x0 = CHART.left + Math.floor((width - gridW) / 2);
    for (let i = 0; i < total; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      cells.push({ index: i, x: x0 + c * (size + CHART.gridGap), y: CHART.gridTop + r * (size + CHART.gridGap), size, tone: badAt.includes(i) ? "bad" : "good" });
    }
    const gridBottom = CHART.gridTop + rows * size + (rows - 1) * CHART.gridGap;
    maxX = Math.max(maxX, x0 + gridW);
    maxY = Math.max(maxY, gridBottom);
    captionTop = gridBottom + CHART.barGap;
    if (chart.progress) {
      const y = gridBottom + CHART.barGap;
      const fillEnd = CHART.left + Math.round((CHART.right - CHART.left) * (chart.progress.value / chart.progress.target));
      bar = { x0: CHART.left, x1: CHART.right, y, h: CHART.barHeight, fillEnd };
      maxX = Math.max(maxX, CHART.right);
      maxY = Math.max(maxY, y + CHART.barHeight + 90);
      captionTop = y + CHART.barHeight + 110;
    }
  }
  if (chart.kind === "pair" && chart.pair) {
    [chart.pair.aLabel, chart.pair.bLabel].forEach((label, i) => {
      const y = CHART.pairTop + i * CHART.pairRowGap;
      pairBars.push({ x0: CHART.pairMarkerX, x1: CHART.pairMarkerX + CHART.pairBarLength, y: y + 46, h: CHART.pairBarHeight, label });
      maxX = Math.max(maxX, CHART.pairMarkerX + CHART.pairBarLength);
      maxY = Math.max(maxY, y + 46 + CHART.pairBarHeight);
    });
    captionTop = CHART.pairTop + 2 * CHART.pairRowGap + 40;
  }
  return { cells, bar, pairBars, captionTop, maxX, maxY };
}

/** The dollar gap a progress bar draws and labels: target - value, rounded down to whole dollars. */
export function progressGapDollars(value: number, target: number): number {
  return Math.floor(target - value + 1e-9);
}

const fmt = (n: number): string => String(n);

/**
 * Checks one chart scene: its structure, that every number it draws is supported by a fact the scene's claims cite
 * (the same rule every spoken or shown number is held to), that a progress bar's gap really is target - value, and that
 * nothing it draws runs under a platform overlay.
 */
export function validateChartScene(scene: SceneSpec, asset: VerifiedAsset): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (code: string, message: string) => issues.push({ severity: "error", code, sceneId: scene.sceneId, message });
  const chart = scene.chart;
  if (!chart) {
    add("chart_missing", "A scene with the chart layout must carry a chart spec.");
    return issues;
  }
  if (scene.crop || scene.clipTimeRangeSeconds) add("chart_has_crop", "A chart scene shows no part of the recording, so it has no crop or clip range.");
  if (!(chart.stage >= 1)) add("chart_bad_stage", "A chart's stage starts at 1.");
  if (chart.lines.length === 0 || chart.lines.join(" ").trim() !== scene.headline.trim()) {
    add("chart_lines_mismatch", `The chart's headline lines ("${chart.lines.join(" ")}") must join back to the scene headline ("${scene.headline}").`);
  }

  const supported = claimEvidenceNumbers(scene, asset);
  const needsFact = (what: string, token: string) => {
    if (!numberIsSupported(token, supported)) add("chart_unsupported_number", `The chart draws ${what} "${token}", which does not appear in any fact this scene cites.`);
  };

  if (chart.kind === "grid_progress") {
    const g = chart.grid;
    if (!g) {
      add("chart_missing_grid", "A grid_progress chart needs a grid.");
    } else {
      const bad = g.total - g.good;
      if (!(g.total >= 1) || g.good < 0 || g.good > g.total || !(g.cols >= 1)) add("chart_bad_grid", "The grid's counts are inconsistent.");
      else if (new Set(g.badAt).size !== g.badAt.length || g.badAt.length !== bad || g.badAt.some((i) => i < 0 || i >= g.total)) {
        add("chart_bad_grid", `The grid has ${bad} bad cell(s) but lists ${g.badAt.length} valid position(s).`);
      }
      needsFact("a cell count", fmt(g.total));
      needsFact("a cell count", fmt(g.good));
    }
    const p = chart.progress;
    if (p) {
      if (!(p.target > 0) || p.value < 0 || p.value > p.target) add("chart_bad_progress", "A progress bar's value must be between 0 and its target.");
      else {
        needsFact("the amount reached", fmt(p.value));
        needsFact("the target", fmt(p.target));
        for (const token of extractNumbers(p.label)) needsFact("a label figure", token);
        const gap = progressGapDollars(p.value, p.target);
        const shown = extractNumbers(p.gapLabel).map((t) => Number(t.replace(/[$,]/g, "")));
        if (shown.length !== 1 || shown[0] !== gap) add("chart_gap_mismatch", `The bar's gap label says "${p.gapLabel}", but target - value is $${gap}.`);
      }
    }
  } else {
    const pr = chart.pair;
    if (!pr) add("chart_missing_pair", "A pair chart needs its pair.");
    else needsFact("the bars' figure", pr.value);
  }

  const geo = chartGeometry(chart);
  if (geo.maxX > CHART.safeRight || geo.maxY > CHART.safeBottom) {
    add("chart_under_overlay", `The chart reaches x=${geo.maxX}, y=${geo.maxY}; it must stay within x<=${CHART.safeRight} and y<=${CHART.safeBottom}.`);
  }
  return issues;
}
