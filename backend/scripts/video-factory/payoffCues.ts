import type { CaptionCue } from "./types.js";
import { escapeAssText } from "./captions.js";
import { PAYOFF, countUpFrames, splitPayoffHeadline } from "../../src/shortform/payoffLayout.js";
import type { PayoffSpec, PayoffTheme, Rect } from "../../src/shortform/types.js";
import type { PayoffCard } from "../../src/shortform/payoffLayout.js";

/** ASS colours are &HBBGGRR&. */
const COLORS: Record<PayoffTheme, { ink: string; muted: string; good: string; bad: string }> = {
  bright: { ink: "&H3B291E&", muted: "&H695547&", good: "&H508C0A&", bad: "&H3C28D2&" },
  dark: { ink: "&HF0E8E2&", muted: "&HC4B39F&", good: "&H96E634&", bad: "&H6E5CFF&" },
};

/** The full-canvas background gradient (top, bottom) each theme uses, as ffmpeg colors. */
export const PAYOFF_BACKGROUNDS: Record<PayoffTheme, { top: string; bottom: string }> = {
  bright: { top: "0xF7F9FC", bottom: "0xD5E1F3" },
  dark: { top: "0x10263a", bottom: "0x05080c" },
};

/**
 * libass draws Poppins ExtraBold at roughly 0.27 x the ASS font size per character (measured on real frames), so
 * these sizes look large: the figure is 340 (about 250px of cap height), the line 110, the caption 70. A long
 * figure shrinks so it still fits the 760px text width (the Pay style keeps text between x=150 and x=930, clear of the platforms' button column).
 */
export const PAYOFF_FONT = { big: 340, bigMin: 140, line: 110, caption: 70, cta: 60, wordsOnly: 150 } as const;

export function bigFontSize(big: string): number {
  return Math.max(PAYOFF_FONT.bigMin, Math.min(PAYOFF_FONT.big, Math.floor(760 / (big.length * 0.27))));
}

const POP_FROM_PERCENT = 78;
const POP_MILLISECONDS = 240;
const COUNT_SECONDS = 0.5;
const COUNT_STEPS = 9;

export interface PayoffCueInput {
  headline: string;
  captionText: string;
  /** The closing invitation, drawn as its own small accent line. Only the last scene has one. */
  cta?: string | null;
  start: number;
  end: number;
  spec: PayoffSpec;
  /** True when a zoomed card sits below the text; false centers the block lower in the frame. */
  hasCard: boolean;
}

/**
 * One payoff scene's text: the big figure (frame one), the short line under it, an optional small caption and CTA,
 * in the "Pay" style (top-anchored, 150px side margins). "pop" scales the figure up into place over ~0.24s; "count"
 * swaps in a count-up of the figure's own digits over the first ~0.5s (never showing a value that isn't the figure's
 * own number counting toward itself). Sign colors the figure (red negative, green otherwise), nothing else. A
 * headline with no leading figure (text-only scenes) is drawn as plain large words.
 */
export function buildPayoffCues(input: PayoffCueInput): CaptionCue[] {
  const { headline, captionText, cta, start, end, spec, hasCard } = input;
  const c = COLORS[spec.theme];
  const text = splitPayoffHeadline(headline);
  const marginV = hasCard ? PAYOFF.textTop : PAYOFF.textOnlyTop;
  const accent = spec.theme === "bright" ? "&H907C0E&" : "&HCFB822&";
  const tail = (): string[] => {
    const parts: string[] = [];
    if (captionText) parts.push(`{\\fs22} `, `{\\fs${PAYOFF_FONT.caption}\\c${c.muted}}${escapeAssText(captionText)}`);
    if (cta) parts.push(`{\\fs22} `, `{\\fs${PAYOFF_FONT.cta}\\c${accent}}${escapeAssText(cta)}`);
    return parts;
  };

  if (!text) {
    const words = `{\\fs${PAYOFF_FONT.wordsOnly}\\c${c.ink}}${escapeAssText(headline)}`;
    return [{ text: [words, ...tail()].join("\\N"), startSeconds: start, endSeconds: end, style: "Pay", marginV }];
  }

  const negative = /^[-−]/.test(text.big);
  const tone = negative ? c.bad : c.good;
  const size = bigFontSize(text.big);
  const block = (bigText: string, bigTag: string): string => {
    const parts = [`{\\fs${size}\\c${tone}${bigTag}}${escapeAssText(bigText)}`];
    if (text.line) parts.push(`{\\fscx100\\fscy100\\fs${PAYOFF_FONT.line}\\c${c.ink}}${escapeAssText(text.line)}`);
    parts.push(...tail());
    return parts.join("\\N");
  };

  if (spec.motion === "count") {
    const frames = countUpFrames(text.big, COUNT_STEPS);
    const step = Math.min(COUNT_SECONDS, Math.max(0, end - start - 0.1)) / frames.length;
    return frames.map((f, i) => ({
      text: block(f, ""),
      startSeconds: start + i * step,
      endSeconds: i === frames.length - 1 ? end : start + (i + 1) * step,
      style: "Pay" as const,
      marginV,
    }));
  }
  const pop = `\\fscx${POP_FROM_PERCENT}\\fscy${POP_FROM_PERCENT}\\t(0,${POP_MILLISECONDS},\\fscx100\\fscy100)`;
  return [{ text: block(text.big, pop), startSeconds: start, endSeconds: end, style: "Pay", marginV }];
}

const CURSOR_LAYER = 5;
const RIPPLE_LAYER = 4;
const CURSOR_DELAY_SECONDS = 0.2;
const CURSOR_MOVE_MILLISECONDS = 450;
/** Classic arrow, tip at (0,0), about 40x62px. */
const CURSOR_SHAPE = "m 0 0 l 0 52 l 13 40 l 22 62 l 32 57 l 23 36 l 40 36";
/** A ring of radius 30 (four bezier quarter-arcs) centered on (0,0). */
const RIPPLE_SHAPE = "m 30 0 b 30 17 17 30 0 30 b -17 30 -30 17 -30 0 b -30 -17 -17 -30 0 -30 b 17 -30 30 -17 30 0";

/** Frame-space limits that keep the pointer clear of the platforms' button column and caption area. */
const CURSOR_MAX_X = 880;
const CURSOR_MAX_Y = 1560 - 62;

export interface PayoffCursorInput {
  card: Pick<PayoffCard, "x" | "y" | "width" | "height">;
  crop: Rect;
  /** The element the narration is about; the pointer lands just inside its lower-right corner. */
  focal: Rect;
  start: number;
  end: number;
}

/**
 * Where the pointer's tip rests on a payoff card, in frame pixels: inside the lower-right of the focal element (so it
 * never covers the figure), mapped from source pixels through the card's own scale, and clamped into the safe area.
 */
export function payoffCursorTarget(input: Pick<PayoffCursorInput, "card" | "crop" | "focal">): { x: number; y: number } {
  const { card, crop, focal } = input;
  const sx = card.width / crop.w;
  const sy = card.height / crop.h;
  const x = card.x + (focal.x + focal.w * 0.88 - crop.x) * sx;
  const y = card.y + (focal.y + focal.h * 0.8 - crop.y) * sy;
  return {
    x: Math.round(Math.min(CURSOR_MAX_X, Math.max(card.x + 30, x))),
    y: Math.round(Math.min(CURSOR_MAX_Y, Math.max(card.y + 10, y))),
  };
}

/**
 * The pointer for one evidence scene: it fades in a beat after the scene opens, glides to the element being described
 * over ~0.45s, and a ring pulses once where it lands. It is drawn on top of the real recording, at render time, so the
 * verified footage, its hash and its facts are untouched.
 */
export function buildPayoffCursorCues(input: PayoffCursorInput): CaptionCue[] {
  const to = payoffCursorTarget(input);
  const from = { x: Math.min(CURSOR_MAX_X, to.x + 120), y: Math.min(CURSOR_MAX_Y, to.y + 170) };
  const appear = input.start + CURSOR_DELAY_SECONDS;
  const landed = appear + CURSOR_MOVE_MILLISECONDS / 1000;
  const pointer: CaptionCue = {
    text: `{\\an7\\move(${from.x},${from.y},${to.x},${to.y},0,${CURSOR_MOVE_MILLISECONDS})\\fad(120,0)\\bord4\\shad0\\1c&HFFFFFF&\\3c&H1E1E1E&\\p1}${CURSOR_SHAPE}{\\p0}`,
    startSeconds: appear,
    endSeconds: input.end,
    style: "Pay",
    layer: CURSOR_LAYER,
  };
  const ripple: CaptionCue = {
    text: `{\\an5\\pos(${to.x},${to.y})\\fscx40\\fscy40\\1a&HFF&\\3c&H907C0E&\\bord6\\shad0\\t(0,420,\\fscx170\\fscy170\\3a&HFF&)\\p1}${RIPPLE_SHAPE}{\\p0}`,
    startSeconds: landed,
    endSeconds: landed + 0.42,
    style: "Pay",
    layer: RIPPLE_LAYER,
  };
  return [pointer, ripple];
}
