import { CANVAS, safeRect } from "./layout.js";
import type { MockSpec, Rect } from "./types.js";

/**
 * Fixed geometry for the "mock" chart kind: a product-mock slide (a source window, a Fillbook step, a Fillbook result
 * window) laid out in HTML and rendered to a 1080x1920 still (scripts/video-factory/mockCard.ts).
 *
 * Nothing on it may sit under what TikTok and YouTube Shorts draw over the video, so every box is checked against the
 * STRICTEST of every rule the pipeline already has:
 *   - SAFE_INSETS for tiktok (top 150, bottom 380, right 120) and youtube_shorts (top 120, bottom 300, right 120), both
 *     applied (layout.ts);
 *   - the owner's measured overlay zones (2026-09-25): the button column from x=930, and the caption/username block from
 *     y=1600 (render.ts PLATFORM_OVERLAY_ZONES);
 *   - the chart cards' own right edge, x=880 (CHART.safeRight), so a mock sits exactly where a chart card does.
 * The geometry is static data, so the check is pure, runs in CI, and a test proves every box clears it. The renderer
 * also measures the real rendered boxes in the browser as a second guard.
 */
const LEFT_MARGIN = 100;
/** The chart cards' right edge (CHART.safeRight in chart.ts, which a test keeps equal; chart.ts imports this file, so it cannot be imported back). */
export const MOCK_RIGHT_LIMIT = 880;
/**
 * Everything on a mock ends above this. TikTok's account name and caption block starts at about y 1520-1540 of the 1920px frame
 * (measured on a guest view, 2026-10-03), so the slide keeps roughly 100px clear of it instead of ending a few pixels short.
 */
export const MOCK_BOTTOM_LIMIT = 1450;
const TOP_MARGIN = 170; // 20px past TikTok's 150px top inset, which is the stricter of the two platforms

export const MOCK_SAFE: Rect = (() => {
  const tiktok = safeRect("tiktok");
  const shorts = safeRect("youtube_shorts");
  const left = Math.max(tiktok.x, shorts.x, LEFT_MARGIN);
  const top = Math.max(tiktok.y, shorts.y, TOP_MARGIN);
  const right = Math.min(tiktok.x + tiktok.w, shorts.x + shorts.w, MOCK_RIGHT_LIMIT);
  const bottom = Math.min(tiktok.y + tiktok.h, shorts.y + shorts.h, MOCK_BOTTOM_LIMIT);
  return { x: left, y: top, w: right - left, h: bottom - top };
})();

export const MOCK_CANVAS = { width: CANVAS.width, height: CANVAS.height } as const;

/** Where every element of the mock sits. Windows have a fixed height, so text that is too long is a validation error, not a reflow. */
export const MOCK_BOXES = {
  logo: { x: MOCK_SAFE.x, y: 170, w: 220, h: 58 },
  eyebrow: { x: MOCK_SAFE.x, y: 250, w: MOCK_SAFE.w, h: 36 },
  headline: { x: MOCK_SAFE.x, y: 298, w: MOCK_SAFE.w, h: 330 },
  source: { x: MOCK_SAFE.x, y: 650, w: MOCK_SAFE.w, h: 276 },
  step: { x: MOCK_SAFE.x, y: 936, w: MOCK_SAFE.w, h: 90 },
  result: { x: MOCK_SAFE.x, y: 1036, w: MOCK_SAFE.w, h: 284 },
  detail: { x: MOCK_SAFE.x, y: 936, w: MOCK_SAFE.w, h: 384 },
  caption: { x: MOCK_SAFE.x, y: 1332, w: MOCK_SAFE.w, h: 64 },
  cta: { x: MOCK_SAFE.x, y: 680, w: MOCK_SAFE.w, h: 300 },
} as const satisfies Record<string, Rect>;

export type MockBoxName = keyof typeof MOCK_BOXES;

/** Font sizes (px) the template draws with. The character budgets below follow from them. */
export const MOCK_FONT = { headline: 106, headlineLine: 110, caption: 42 } as const;

/** Most characters each text may have so it fits its fixed box (Space Grotesk / Manrope / JetBrains Mono at the sizes above). */
export const MOCK_LIMITS = {
  eyebrow: 26,
  headlineLines: 3,
  headlineLineChars: 13,
  windowTitle: 26,
  column: 12,
  rows: 2,
  when: 14,
  symbol: 8,
  value: 16,
  step: 24,
  tag: 12,
  statLabel: 30,
  statValue: 6,
  statUnit: 10,
  statNote: 26,
  detailRows: 3,
  detailLabel: 24,
  detailValue: 12,
  footer: 30,
  caption: 30,
  cta: 80,
} as const;

/** Names of the boxes that stick out of the safe rectangle (an empty list means the layout is clear of every platform overlay). */
export function boxesOutsideSafeArea(): MockBoxName[] {
  const out: MockBoxName[] = [];
  for (const [name, b] of Object.entries(MOCK_BOXES) as Array<[MockBoxName, Rect]>) {
    if (b.x < MOCK_SAFE.x || b.y < MOCK_SAFE.y || b.x + b.w > MOCK_SAFE.x + MOCK_SAFE.w || b.y + b.h > MOCK_SAFE.y + MOCK_SAFE.h) out.push(name);
  }
  return out;
}

/** Every text in a mock spec, with a label for error messages. The numbers in these must all come from the facts a scene cites. */
export function mockTexts(spec: MockSpec, headlineLines: string[], caption: string, cta: string | null): Array<[string, string]> {
  const t: Array<[string, string]> = [["eyebrow", spec.eyebrow], ["step", spec.step], ["source title", spec.source.title], ["result title", spec.result.title], ["tag", spec.result.tag]];
  headlineLines.forEach((l, i) => t.push([`headline line ${i + 1}`, l]));
  spec.source.columns.forEach((c, i) => t.push([`column ${i + 1}`, c]));
  spec.source.rows.forEach((r, i) => {
    t.push([`row ${i + 1} when`, r.when], [`row ${i + 1} symbol`, r.symbol], [`row ${i + 1} value`, r.value]);
  });
  spec.result.stats.forEach((s, i) => {
    t.push([`stat ${i + 1} label`, s.label], [`stat ${i + 1} value`, s.value]);
    if (s.unit) t.push([`stat ${i + 1} unit`, s.unit]);
    if (s.note) t.push([`stat ${i + 1} note`, s.note]);
  });
  if (spec.details) {
    t.push(["detail title", spec.details.title], ["detail footer", spec.details.footer]);
    spec.details.rows.forEach((r, i) => t.push([`detail row ${i + 1} label`, r.label], [`detail row ${i + 1} value`, r.value]));
  }
  t.push(["caption", caption]);
  if (cta) t.push(["invitation", cta]);
  return t;
}

/** Character-budget problems with a mock spec, as plain messages. Pure, so it runs wherever plans are validated. */
export function mockFitProblems(spec: MockSpec, headlineLines: string[], caption: string, cta: string | null): string[] {
  const L = MOCK_LIMITS;
  const p: string[] = [];
  const over = (what: string, text: string, max: number) => {
    if (text.length > max) p.push(`${what} "${text}" is ${text.length} characters; the most that fits its box is ${max}.`);
  };
  over("eyebrow", spec.eyebrow, L.eyebrow);
  if (headlineLines.length < 1 || headlineLines.length > L.headlineLines) p.push(`The headline must be 1 to ${L.headlineLines} lines, not ${headlineLines.length}.`);
  headlineLines.forEach((l, i) => over(`headline line ${i + 1}`, l, L.headlineLineChars));
  if (spec.accentFrom < 0 || spec.accentFrom >= headlineLines.length) p.push("accentFrom must be the index of one of the headline lines.");
  over("source title", spec.source.title, L.windowTitle);
  spec.source.columns.forEach((c, i) => over(`column ${i + 1}`, c, L.column));
  if (spec.source.rows.length < 1 || spec.source.rows.length > L.rows) p.push(`The source window holds 1 to ${L.rows} rows, not ${spec.source.rows.length}.`);
  spec.source.rows.forEach((r, i) => {
    over(`row ${i + 1} when`, r.when, L.when);
    over(`row ${i + 1} symbol`, r.symbol, L.symbol);
    over(`row ${i + 1} value`, r.value, L.value);
  });
  over("step", spec.step, L.step);
  over("result title", spec.result.title, L.windowTitle);
  over("tag", spec.result.tag, L.tag);
  spec.result.stats.forEach((s, i) => {
    over(`stat ${i + 1} label`, s.label, L.statLabel);
    over(`stat ${i + 1} value`, s.value, L.statValue);
    if (s.unit) over(`stat ${i + 1} unit`, s.unit, L.statUnit);
    if (s.note) over(`stat ${i + 1} note`, s.note, L.statNote);
  });
  if (spec.details) {
    const d = spec.details;
    over("detail title", d.title, L.windowTitle);
    over("detail footer", d.footer, L.footer);
    if (d.rows.length !== L.detailRows) p.push(`The detail card holds exactly ${L.detailRows} rows, not ${d.rows.length}.`);
    d.rows.forEach((r, i) => {
      over(`detail row ${i + 1} label`, r.label, L.detailLabel);
      over(`detail row ${i + 1} value`, r.value, L.detailValue);
    });
  }
  over("caption", caption, L.caption);
  if (cta) over("invitation", cta, L.cta);
  return p;
}
