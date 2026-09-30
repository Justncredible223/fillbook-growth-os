import type { CaptionCue } from "./types.js";
import { escapeAssText } from "./captions.js";
import { PAYOFF, countUpFrames, splitPayoffHeadline } from "../../src/shortform/payoffLayout.js";
import type { PayoffSpec, PayoffTheme } from "../../src/shortform/types.js";

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
