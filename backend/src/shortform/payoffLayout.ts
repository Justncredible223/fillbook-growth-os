import type { Rect } from "./types.js";

/**
 * Geometry of a "payoff" scene's zoomed evidence card (1080x1920 frame). The big number and its line sit above
 * PAYOFF_CARD_TOP; the card sits in the band below it. The card's right edge (x <= 890) stays clear of the platforms'
 * right-hand button column (x >= 930), and its bottom stays above the caption area (y >= 1600) -- the same two
 * overlay zones every other card layout respects (see render.ts's PLATFORM_OVERLAY_ZONES).
 */
export const PAYOFF = {
  canvasWidth: 1080,
  cardMaxWidth: 700,
  cardTop: 1010,
  cardMaxBottom: 1560,
  /** A crop may be enlarged at most this much: past it, source pixels visibly soften. */
  upscaleMax: 2.6,
  /** Soft warning above this. */
  upscaleWarn: 2.2,
  cornerRadius: 28,
  /** Text block above the card: big number, line, small caption. */
  textTop: 380,
  /** A payoff scene with no card centers its text block lower in the frame. */
  textOnlyTop: 700,
  textBottomLimit: 1000,
} as const;

export interface PayoffCard {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  radius: number;
}

export function computePayoffCard(crop: Pick<Rect, "w" | "h">): PayoffCard {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const maxHeight = PAYOFF.cardMaxBottom - PAYOFF.cardTop;
  const scale = Math.min(PAYOFF.cardMaxWidth / crop.w, maxHeight / crop.h, PAYOFF.upscaleMax);
  const width = even(crop.w * scale);
  const height = even(crop.h * scale);
  // Centered in the band below the text, so a short card floats mid-frame instead of hugging the number above it.
  const y = Math.round(PAYOFF.cardTop + (maxHeight - height) / 2);
  return { x: (PAYOFF.canvasWidth - width) / 2, y, width, height, scale, radius: PAYOFF.cornerRadius };
}

/** A headline's first token is the "big number" when it is a figure ($1,725, -$17, 64%, 22) rather than a word. */
const BIG_TOKEN = /^[-+−]?\$?\d[\d,]*(?:\.\d+)?(?:%|R|x)?[.,:]?$/;

export interface PayoffText {
  /** The large first-frame figure, e.g. "$1,725". */
  big: string;
  /** The short line under it, e.g. "left before your floor". */
  line: string;
}

/** Splits a payoff headline into its big figure and its line, or null when it does not start with a figure. */
export function splitPayoffHeadline(headline: string): PayoffText | null {
  const trimmed = headline.trim();
  const space = trimmed.search(/\s/);
  const first = space === -1 ? trimmed : trimmed.slice(0, space);
  if (!BIG_TOKEN.test(first)) return null;
  return { big: first.replace(/[.,:]$/, ""), line: space === -1 ? "" : trimmed.slice(space).trim() };
}

/** Words on screen in one payoff scene (brief: 5-7 per screen), counting the big figure as one. */
export function payoffWordCount(headline: string): number {
  return headline.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Frames of the count-up: the figure's own digits interpolated from `fromFraction` of its value up to its value,
 * keeping its sign, $ prefix, thousands commas, decimals and % / x suffix. Returns the final value's string as the
 * last entry. Pure, so it is unit-testable without ffmpeg.
 */
export function countUpFrames(big: string, steps: number, fromFraction = 0.6): string[] {
  const m = big.match(/^([-+−]?)(\$?)(\d[\d,]*)(\.\d+)?(%|R|x)?$/);
  if (!m || steps < 2) return [big];
  const [, sign, dollar, intPart, decPart, suffix] = m;
  const decimals = decPart ? decPart.length - 1 : 0;
  const target = Number(`${intPart!.replace(/,/g, "")}${decPart ?? ""}`);
  const frames: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const eased = 1 - (1 - t) * (1 - t);
    const value = target * (fromFraction + (1 - fromFraction) * eased);
    const rounded = i === steps - 1 ? target : Number(value.toFixed(decimals));
    const text = rounded.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    frames.push(`${sign}${dollar}${text}${suffix ?? ""}`);
  }
  return frames;
}
