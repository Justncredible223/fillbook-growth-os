import type { CaptionCue } from "./types.js";
import { escapeAssText } from "./captions.js";
import { CAPTION_WRAP_CHARS, CHART, CTA_WRAP_CHARS, chartGeometry, wrapCaption } from "../../src/shortform/chart.js";

export { wrapCaption };
import type { ChartSpec, ChartTone } from "../../src/shortform/types.js";

/**
 * Chart-card scenes drawn as ASS vector shapes, so they ride the same ffmpeg + libass renderer as every other video:
 * no extra software on the render runner, and the cards, bars and text are all part of one subtitle track. The
 * background is the payoff pipeline's dark gradient (see PAYOFF_BACKGROUNDS), built by the adapter.
 *
 * Each scene draws the chart up to its `stage`: beats before it are drawn already complete (so the crossfade between two
 * scenes of one video is seamless), this scene's own beat animates in, and later beats are not drawn yet.
 */

/** ASS colours are &HBBGGRR&. */
const COLOR = {
  ink: "&HF8F4F0&",
  muted: "&HA69888&",
  good: "&H96B02A&",
  bad: "&H4444EF&",
  track: "&H36281E&",
  accent: "&HC4D678&",
} as const;

const LAYER_SHAPE = 1;
const LAYER_TEXT = 2;

/** Width of one glyph as a fraction of the ASS font size for Poppins ExtraBold, as measured on real frames. */
export const CHART_GLYPH_EM = 0.27;

const CELL_STEP = 0.11;
const CELL_POP_MS = 280;
const FILL_SECONDS = 1.1;
const DIM_ALPHA = "&H8C&";

const fmt = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * A rounded rectangle as an ASS drawing (four quarter-arc beziers), spanning (0,0) to (w,h). libass anchors a drawing
 * from its (0,0) corner, so a path centred on the origin would land half off its \pos; keep every coordinate >= 0.
 */
export function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  const c = rr * 0.4477;
  const p = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
  return [
    `m ${p(rr, 0)}`,
    `l ${p(w - rr, 0)}`,
    `b ${p(w - c, 0)} ${p(w, c)} ${p(w, rr)}`,
    `l ${p(w, h - rr)}`,
    `b ${p(w, h - c)} ${p(w - c, h)} ${p(w - rr, h)}`,
    `l ${p(rr, h)}`,
    `b ${p(c, h)} ${p(0, h - c)} ${p(0, h - rr)}`,
    `l ${p(0, rr)}`,
    `b ${p(0, c)} ${p(c, 0)} ${p(rr, 0)}`,
  ].join(" ");
}

/** Largest ASS font size at which `text` fits `maxWidth` pixels, never above `size`. */
export function fitFont(text: string, size: number, maxWidth: number, min = 30): number {
  let fs = size;
  while (fs > min && text.length * CHART_GLYPH_EM * fs > maxWidth) fs -= 2;
  return fs;
}

const toneColor = (t: ChartTone): string => (t === "bad" ? COLOR.bad : COLOR.good);

export interface ChartCueInput {
  chart: ChartSpec;
  headline: string;
  captionText: string;
  cta?: string | null;
  /** Scene window in video seconds. */
  start: number;
  end: number;
}

interface Builder {
  cues: CaptionCue[];
  push(text: string, from: number, to: number, layer: number): void;
}

function shape(path: string, x: number, y: number, fill: string, extra = ""): string {
  return `{\\an5\\pos(${fmt(x)},${fmt(y)})\\bord0\\shad0\\1c${fill}${extra}\\p1}${path}{\\p0}`;
}

/** Draws every cue for one chart scene. Pure: the same input always gives the same cues. */
export function buildChartCues(input: ChartCueInput): CaptionCue[] {
  const { chart, captionText, cta, start, end } = input;
  const geo = chartGeometry(chart);
  const dur = end - start;
  const b: Builder = {
    cues: [],
    push(text, from, to, layer) {
      b.cues.push({ text, startSeconds: Math.max(start, from), endSeconds: Math.min(end, to), style: "Chart", layer });
    },
  };
  const dim = chart.dim ? `\\1a${DIM_ALPHA}` : "";
  const stage = chart.stage;

  // ---- the headline: on screen from frame one, a short pop on the opening scene only ----
  const lineFs = chart.lines.map((l) => fitFont(l, CHART.hookFont, CHART.right - CHART.left));
  chart.lines.forEach((line, i) => {
    const y = CHART.hookTop + i * CHART.hookLineHeight + CHART.hookLineHeight / 2;
    const tone = i === chart.lines.length - 1 ? toneColor(chart.accent) : COLOR.ink;
    const pop = stage === 1 ? `\\fscx88\\fscy88\\t(0,260,\\fscx100\\fscy100)` : "";
    b.push(`{\\an5\\pos(${CHART.centerX},${fmt(y)})\\fs${lineFs[i]}\\c${tone}${pop}}${escapeAssText(line)}`, start, end, LAYER_TEXT);
  });

  // ---- grid + progress bar ----
  if ((chart.kind === "grid_progress" || chart.kind === "outcomes") && chart.grid) {
    const step = Math.min(CELL_STEP, Math.max(0.04, (dur - 1.0) / Math.max(1, geo.cells.length)));
    for (const cell of geo.cells) {
      const cx = cell.x + cell.size / 2;
      const cy = cell.y + cell.size / 2;
      const path = roundedRectPath(cell.size, cell.size, cell.size * 0.16);
      const fill = cell.tone === "bad" ? COLOR.bad : COLOR.good;
      if (stage === 1) {
        const at = start + cell.index * step;
        b.push(shape(path, cx, cy, fill, `\\fscx55\\fscy55\\1a&HFF&\\t(0,${CELL_POP_MS},\\fscx100\\fscy100\\1a&H00&)`), at, end, LAYER_SHAPE);
      } else {
        b.push(shape(path, cx, cy, fill, dim), start, end, LAYER_SHAPE);
      }
    }

    const bar = geo.bar;
    const p = chart.progress;
    if (bar && p && stage >= 2) {
      const at = stage === 2 ? start + 0.2 : start;
      const anim = stage === 2;
      const fade = anim ? `\\fad(300,0)` : "";
      // label above the bar
      const labelFs = fitFont(p.label, 58, CHART.right - CHART.left);
      b.push(`{\\an5\\pos(${CHART.centerX},${bar.y - 38})\\fs${labelFs}\\c${COLOR.muted}${fade}${chart.dim ? `\\1a${DIM_ALPHA}` : ""}}${escapeAssText(p.label)}`, at, end, LAYER_TEXT);
      // track
      b.push(shape(roundedRectPath(bar.x1 - bar.x0, bar.h, 14), (bar.x0 + bar.x1) / 2, bar.y + bar.h / 2, COLOR.track, `${fade}${dim}`), at, end, LAYER_SHAPE);
      // fill, revealed left to right by an animated clip
      const fillPath = roundedRectPath(bar.fillEnd - bar.x0, bar.h, 14);
      const fillY = bar.y + bar.h / 2;
      const clip = anim
        ? `\\clip(${bar.x0},${bar.y - 2},${bar.x0},${bar.y + bar.h + 2})\\t(${Math.round((at - start) * 1000) + 200},${Math.round((at - start) * 1000) + 200 + Math.round(FILL_SECONDS * 1000)},\\clip(${bar.x0},${bar.y - 2},${bar.fillEnd + 2},${bar.y + bar.h + 2}))`
        : "";
      b.push(shape(fillPath, (bar.x0 + bar.fillEnd) / 2, fillY, COLOR.good, `${clip}${dim}`), at, end, LAYER_SHAPE);
      // the missing part, outlined, with its label
      const gapAt = anim ? start + 0.2 + 0.2 + FILL_SECONDS + 0.1 : start;
      const gapW = bar.x1 - bar.fillEnd;
      if (gapW > 4) {
        const gapFade = anim ? `\\fad(250,0)` : "";
        const gapPath = roundedRectPath(Math.max(8, gapW - 6), bar.h - 6, 11);
        b.push(`{\\an5\\pos(${fmt((bar.fillEnd + bar.x1) / 2)},${fmt(fillY)})\\1a&HFF&\\3c${COLOR.bad}\\bord5\\shad0${gapFade}${chart.dim ? `\\3a${DIM_ALPHA}` : ""}\\p1}${gapPath}{\\p0}`, gapAt, end, LAYER_SHAPE);
      }
      const gapFs = fitFont(p.gapLabel, 66, CHART.right - CHART.left);
      b.push(`{\\an5\\pos(${CHART.centerX},${bar.y + bar.h + 44})\\fs${gapFs}\\c${COLOR.bad}${anim ? `\\fad(250,0)` : ""}${chart.dim ? `\\1a${DIM_ALPHA}` : ""}}${escapeAssText(p.gapLabel)}`, gapAt, end, LAYER_TEXT);
    }

    // stage 3: the bad cells pulse, so the eye lands on the red day
    if (chart.kind === "grid_progress" && stage === 3) {
      for (const cell of geo.cells.filter((c) => c.tone === "bad")) {
        const cx = cell.x + cell.size / 2;
        const cy = cell.y + cell.size / 2;
        const ring = roundedRectPath(cell.size + 14, cell.size + 14, cell.size * 0.2);
        for (let k = 0; k < 3; k++) {
          const t0 = start + 0.15 + k * 0.7;
          b.push(`{\\an5\\pos(${fmt(cx)},${fmt(cy)})\\1a&HFF&\\3c${COLOR.bad}\\bord6\\shad0\\fscx100\\fscy100\\t(0,600,\\fscx118\\fscy118\\3a&HFF&)\\p1}${ring}{\\p0}`, t0, t0 + 0.6, LAYER_SHAPE + 1);
        }
      }
    }
  }

  // ---- outcomes: the total won and the total lost as two bars, then the net ----
  if (chart.kind === "outcomes" && chart.bars && chart.net) {
    geo.outcomeBars.forEach((ob, i) => {
      if (stage < 2) return;
      const spec = chart.bars![i]!;
      const anim = stage === 2;
      const at = anim ? start + 0.3 + i * 0.6 : start;
      const tone = toneColor(spec.tone);
      const fade = anim ? `\\fad(250,0)` : "";
      const dimText = chart.dim ? `\\1a${DIM_ALPHA}` : "";
      b.push(`{\\an4\\pos(${ob.x0},${ob.y - 30})\\fs52\\c${COLOR.muted}${fade}${dimText}}${escapeAssText(spec.label)}`, at, end, LAYER_TEXT);
      const clip = anim
        ? `\\clip(${ob.x0},${ob.y - 2},${ob.x0},${ob.y + ob.h + 2})\\t(0,1000,\\clip(${ob.x0},${ob.y - 2},${ob.x1 + 2},${ob.y + ob.h + 2}))`
        : "";
      b.push(shape(roundedRectPath(ob.x1 - ob.x0, ob.h, 14), (ob.x0 + ob.x1) / 2, ob.y + ob.h / 2, tone, `${clip}${dim}`), at, end, LAYER_SHAPE);
      const inside = ob.x1 - ob.x0 >= 300;
      const valueAt = anim ? at + 0.9 : at;
      const valueTag = inside ? `\\an6\\pos(${ob.x1 - 22},${fmt(ob.y + ob.h / 2)})` : `\\an4\\pos(${ob.x1 + 24},${fmt(ob.y + ob.h / 2)})`;
      b.push(`{${valueTag}\\fs60\\c${COLOR.ink}${anim ? `\\fad(200,0)` : ""}${dimText}}${escapeAssText(spec.display)}`, valueAt, end, LAYER_TEXT);
    });
    if (stage >= 3) {
      const anim = stage === 3;
      const pop = anim ? `\\fscx80\\fscy80\\t(0,300,\\fscx100\\fscy100)` : "";
      b.push(`{\\an5\\pos(${CHART.centerX},${fmt(geo.netY)})\\fs190\\c${toneColor(chart.net.tone)}${pop}${chart.dim ? `\\1a${DIM_ALPHA}` : ""}}${escapeAssText(chart.net.display)}`, start, end, LAYER_TEXT);
    }
  }

  // ---- bars: labelled rows drawn from one recording's facts ----
  if (chart.kind === "bars" && chart.rows) {
    const dimText = chart.dim ? `\\1a${DIM_ALPHA}` : "";
    geo.rowBars.forEach((rb, i) => {
      const spec = chart.rows![i]!;
      const anim = stage === 1;
      const at = anim ? start + 0.25 + i * 0.32 : start;
      const fade = anim ? `\\fad(220,0)` : "";
      const tone = toneColor(spec.tone);
      b.push(`{\\an4\\pos(${rb.x0},${rb.y - CHART.barsLabelGap})\\fs${fitFont(spec.label, 46, CHART.right - CHART.left)}\\c${COLOR.muted}${fade}${dimText}}${escapeAssText(spec.label)}`, at, end, LAYER_TEXT);
      const clip = anim
        ? `\\clip(${rb.x0},${rb.y - 2},${rb.x0},${rb.y + rb.h + 2})\\t(0,800,\\clip(${rb.x0},${rb.y - 2},${rb.x1 + 2},${rb.y + rb.h + 2}))`
        : "";
      b.push(shape(roundedRectPath(rb.x1 - rb.x0, rb.h, 12), (rb.x0 + rb.x1) / 2, rb.y + rb.h / 2, tone, `${clip}${dim}`), at, end, LAYER_SHAPE);
      const inside = rb.x1 - rb.x0 >= 300;
      const valueAt = anim ? at + 0.7 : at;
      const valueTag = inside ? `\\an6\\pos(${rb.x1 - 18},${fmt(rb.y + rb.h / 2)})` : `\\an4\\pos(${rb.x1 + 22},${fmt(rb.y + rb.h / 2)})`;
      b.push(`{${valueTag}\\fs54\\c${COLOR.ink}${anim ? `\\fad(160,0)` : ""}${dimText}}${escapeAssText(spec.display)}`, valueAt, end, LAYER_TEXT);
    });
    // stage 3: the highlighted row pulses, so the eye lands on the one that matters
    if (stage === 3 && chart.highlight !== undefined) {
      const rb = geo.rowBars[chart.highlight]!;
      const spec = chart.rows[chart.highlight]!;
      const ringW = rb.x1 - rb.x0 + 20;
      const ring = roundedRectPath(ringW, rb.h + 16, 16);
      for (let k = 0; k < 3; k++) {
        const t0 = start + 0.15 + k * 0.7;
        b.push(`{\\an5\\pos(${fmt(rb.x0 - 10 + ringW / 2)},${fmt(rb.y + rb.h / 2)})\\1a&HFF&\\3c${toneColor(spec.tone)}\\bord6\\shad0\\fscx100\\fscy100\\t(0,600,\\fscx106\\fscy112\\3a&HFF&)\\p1}${ring}{\\p0}`, t0, t0 + 0.6, LAYER_SHAPE + 1);
      }
    }
  }

  // ---- pair of bars from one marker ----
  if (chart.kind === "pair" && chart.pair) {
    const markerTop = CHART.pairTop - 20;
    const markerBottom = CHART.pairTop + CHART.pairRowGap + 46 + CHART.pairBarHeight + 24;
    b.push(shape(roundedRectPath(6, markerBottom - markerTop, 3), CHART.pairMarkerX - 8, (markerTop + markerBottom) / 2, "&HA08C78&", stage === 1 ? `\\fad(300,0)` : dim), start, end, LAYER_SHAPE);
    b.push(`{\\an4\\pos(${CHART.pairMarkerX + 4},${CHART.pairTop - 44})\\fs52\\c${COLOR.muted}${stage === 1 ? `\\fad(300,0)` : ""}}one signal`, start, end, LAYER_TEXT);
    geo.pairBars.forEach((bar, i) => {
      const barStage = i + 1;
      if (stage < barStage) return;
      const anim = stage === barStage;
      const at = anim ? start + 0.5 : start;
      const midY = bar.y + bar.h / 2;
      b.push(`{\\an4\\pos(${CHART.pairMarkerX + 140},${bar.y - 30})\\fs52\\c${COLOR.muted}${anim ? `\\fad(250,0)` : ""}${chart.dim ? `\\1a${DIM_ALPHA}` : ""}}${escapeAssText(bar.label)}`, at, end, LAYER_TEXT);
      const path = roundedRectPath(bar.x1 - bar.x0, bar.h, 14);
      const clip = anim
        ? `\\clip(${bar.x0},${bar.y - 2},${bar.x0},${bar.y + bar.h + 2})\\t(0,1300,\\clip(${bar.x0},${bar.y - 2},${bar.x1 + 2},${bar.y + bar.h + 2}))`
        : "";
      b.push(shape(path, (bar.x0 + bar.x1) / 2, midY, COLOR.bad, `${clip}${dim}`), at, end, LAYER_SHAPE);
      const valueAt = anim ? at + 1.0 : at;
      b.push(`{\\an6\\pos(${bar.x1 - 24},${fmt(midY)})\\fs76\\c${COLOR.ink}${anim ? `\\fad(200,0)` : ""}${chart.dim ? `\\1a${DIM_ALPHA}` : ""}}${escapeAssText(chart.pair!.value)}`, valueAt, end, LAYER_TEXT);
    });
  }

  // ---- the beat caption, under the chart ----
  if (captionText) {
    const lines = wrapCaption(captionText, CAPTION_WRAP_CHARS);
    const fs = 78;
    const fade = stage <= 3 ? `\\fad(250,0)` : "";
    lines.forEach((line, i) => {
      b.push(`{\\an5\\pos(${CHART.centerX},${fmt(geo.captionTop + i * CHART.captionPitch + CHART.captionPitch / 2)})\\fs${fs}\\c${COLOR.ink}${fade}}${escapeAssText(line)}`, start + (stage === 1 ? 0.5 : 0.3), end, LAYER_TEXT);
    });
  }

  // ---- the closing invitation ----
  if (cta) {
    const lines = wrapCaption(cta, CTA_WRAP_CHARS);
    const ctaTop = geo.captionTop + (captionText ? wrapCaption(captionText, CAPTION_WRAP_CHARS).length * CHART.captionPitch : 0) + CHART.ctaGap;
    lines.forEach((line, i) => {
      b.push(`{\\an5\\pos(${CHART.centerX},${ctaTop + i * CHART.ctaPitch + CHART.ctaPitch / 2})\\fs52\\c${COLOR.accent}\\fad(300,0)}${escapeAssText(line)}`, start + 0.3, end, LAYER_TEXT);
    });
  }
  return b.cues;
}
