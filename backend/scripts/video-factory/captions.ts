import type { CaptionCue, WordCue } from "./types.js";

/**
 * voiceover.ts's respellFillbookForTts sends "Fillbook" to TTS as the two
 * real dictionary words "Fill book" so it's pronounced correctly -- which
 * means the raw WordBoundary stream reports "Fill" and "book" as two
 * separate word cues. This merges any such adjacent pair back into one
 * "Fillbook" cue (spanning both words' combined time range) before caption
 * phrases are built, so it still displays and highlights as a single word
 * on screen, matching what it actually is. Matches on bare letters only
 * (strips punctuation) so a "Fill book." at a sentence end still merges.
 */
export function mergeBrandNameWordCues(wordCues: WordCue[]): WordCue[] {
  const merged: WordCue[] = [];
  for (let i = 0; i < wordCues.length; i++) {
    const current = wordCues[i]!;
    const next = wordCues[i + 1];
    const currentBare = current.text.replace(/[^a-zA-Z]/g, "").toLowerCase();
    const nextBare = next?.text.replace(/[^a-zA-Z]/g, "").toLowerCase();
    if (next && currentBare === "fill" && nextBare === "book") {
      merged.push({ text: "Fillbook", startSeconds: current.startSeconds, endSeconds: next.endSeconds });
      i++;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/** A gap this long between two spoken words reads as a natural phrase boundary -- mirrors how a human captioner would chunk a sentence, not an arbitrary fixed word count. */
const PAUSE_BREAK_SECONDS = 0.35;

/** Sized so a phrase reads as one short on-screen line at 1080px/64pt, similar sizing rationale to the old sentence-splitting cap. */
const MAX_PHRASE_CHARS = 34;
const MAX_PHRASE_WORDS = 6;

/**
 * Groups flat word-level timing into short on-screen phrases (2-6 words),
 * breaking at natural speech pauses before falling back to a max-length
 * cap. Each phrase becomes one stationary on-screen caption line, with
 * word-by-word highlighting applied within it (see buildWordHighlightCues).
 */
export function groupWordsIntoPhrases(words: WordCue[]): WordCue[][] {
  const phrases: WordCue[][] = [];
  let current: WordCue[] = [];
  let currentChars = 0;

  for (const word of words) {
    const prev = current[current.length - 1];
    const gap = prev ? word.startSeconds - prev.endSeconds : 0;
    const wouldExceed = currentChars + word.text.length + 1 > MAX_PHRASE_CHARS || current.length >= MAX_PHRASE_WORDS;
    if (current.length > 0 && (gap >= PAUSE_BREAK_SECONDS || wouldExceed)) {
      phrases.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(word);
    currentChars += word.text.length + 1;
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

/** Brand cyan, ASS BGR (matches the old Hook style colour) -- the one highlight colour used for whichever word is currently being spoken. */
const HIGHLIGHT_COLOR_TAG = "\\c&H00EED322&";
/** Both styles' own PrimaryColour is white (see ASS_HEADER) -- this override switches a word back to it once it's no longer the active one. */
const BASE_COLOR_TAG = "\\c&H00FFFFFF&";

/**
 * Builds one Dialogue line per word within a phrase: the full phrase text
 * is shown throughout the phrase's duration, with only the
 * currently-spoken word's colour swapped to the highlight via an inline
 * ASS override tag -- the TikTok/CapCut "active word" caption look. One
 * Dialogue line per word (rather than ASS's built-in \k karaoke tag) so the
 * highlighted word is exactly and deterministically the one currently
 * being spoken, with no dependence on how a given libass build interprets
 * \k timing.
 *
 * Each word's display window is extended to the next word's start time
 * (rather than its own real end time) so there's no blank-caption flicker
 * during the brief natural articulation gaps between words in the same
 * phrase.
 */
export function buildWordHighlightCues(phrase: WordCue[], style: "Hook" | "Caption"): CaptionCue[] {
  const escapedWords = phrase.map((w) => escapeAssText(w.text));
  return phrase.map((word, i) => {
    const text = escapedWords.map((w, j) => (j === i ? `{${HIGHLIGHT_COLOR_TAG}}${w}{${BASE_COLOR_TAG}}` : w)).join(" ");
    const start = word.startSeconds;
    const nextWord = phrase[i + 1];
    const end = nextWord ? nextWord.startSeconds : word.endSeconds;
    return { text, startSeconds: start, endSeconds: end, style };
  });
}

/**
 * Builds the final caption cue list from real word-level timing: words are
 * grouped into short phrases, and the first phrase (the hook, spoken first
 * by construction -- videoScriptWriter puts it at the start of `script`)
 * is tagged with the larger "Hook" style.
 */
export function buildCaptionCues(wordCues: WordCue[]): CaptionCue[] {
  if (wordCues.length === 0) return [];
  const phrases = groupWordsIntoPhrases(wordCues);
  return phrases.flatMap((phrase, i) => buildWordHighlightCues(phrase, i === 0 ? "Hook" : "Caption"));
}

/**
 * Midpoint of the Hook phrase's total on-screen window -- the moment a
 * thumbnail frame should be pulled from (see render.ts's extractThumbnail),
 * since it's guaranteed to show bold, on-brand caption text regardless of
 * which specific word happens to be highlighted at that instant. Null only
 * if buildCaptionCues was given no words at all (nothing to show).
 */
export function getHookMidpointSeconds(captionCues: CaptionCue[]): number | null {
  const hookCues = captionCues.filter((c) => c.style === "Hook");
  if (hookCues.length === 0) return null;
  const start = Math.min(...hookCues.map((c) => c.startSeconds));
  const end = Math.max(...hookCues.map((c) => c.endSeconds));
  return (start + end) / 2;
}

/**
 * A brief brand card ("FILLBOOK" / "fillbookhq.com") shown during the
 * silence pad already reserved at the end of every render for the closing
 * caption to breathe (see render-single.ts/index.ts's SILENCE_PAD_SECONDS)
 * -- reuses that existing dead-air window rather than extending the
 * video's total duration. Middle-centered (the "Outro" style's own
 * Alignment=5, distinct from Caption/Hook's bottom-anchored Alignment=2)
 * so it reads as a deliberate closing beat, not another caption line.
 */
export function buildOutroCue(totalDurationSeconds: number, silencePadSeconds: number): CaptionCue {
  const text = `FILLBOOK\\N{\\fs40\\c&H00FFFFFF&}fillbookhq.com`;
  return {
    text,
    startSeconds: Math.max(0, totalDurationSeconds - silencePadSeconds),
    endSeconds: totalDurationSeconds,
    style: "Outro",
  };
}

/** ASS uses centisecond precision and H:MM:SS.CC, not SRT's HH:MM:SS,mmm. */
export function secondsToAssTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.round((totalSeconds - Math.floor(totalSeconds)) * 100);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centiseconds)}`;
}

/**
 * Escapes a single word's text for a literal ASS Dialogue line. `{`/`}`
 * open override blocks in ASS -- stripping them (never expected in real
 * TTS word text) is simpler and safer than trying to escape-and-preserve
 * them. Applied per-word, before buildWordHighlightCues wraps the active
 * word in its own override braces, so those wrapper braces are never
 * stripped by this call.
 */
export function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\r\n|\n/g, "\\N");
}

/**
 * Known-good header from ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md:
 * PlayResX/PlayResY MUST match the render resolution (this is what fixed
 * the libass clipping bug), Alignment=5 (middle-center) avoids
 * margin-from-edge ambiguity. Hook and Caption now share the same white
 * PrimaryColour -- the brand-cyan pop lives entirely in the per-word
 * override tags in buildWordHighlightCues, so "highlighted" always means
 * the same thing regardless of which style a phrase uses; only Hook's
 * larger fontsize sets it apart. A third "SceneLabel" style (see scenes.ts)
 * reuses the same subtitles-filter mechanism for on-screen scene text,
 * since drawtext segfaults on this ffmpeg build.
 *
 * Fontname is the bundled "Poppins ExtraBold" (see render.ts's
 * FONT_ASSET_PATH/fontsdir wiring), not Arial/Verdana -- ubuntu-latest
 * (where every real render actually runs) has neither of those installed,
 * so libass was silently substituting its own default sans-serif fallback
 * before this; bundling a specific bold, rounded font makes captions look
 * deliberately designed rather than like whatever happened to be on the
 * rendering machine, and thicker Outline/Shadow give the text more pop
 * against busy stock-footage backgrounds.
 *
 * Caption/Hook MarginV=320 (2026-09-10, raised from 160): owner-confirmed
 * on a real TikTok upload -- at 160 (only ~8% of the 1920px canvas), the
 * burned-in caption sat directly behind TikTok's own post
 * description/username text, which TikTok renders in that same bottom
 * strip regardless of what the video itself contains. 320px (~17%) clears
 * that UI band with real margin to spare; verified against TikTok's own
 * safe-zone guidance for that region. SceneLabel (top-anchored, MarginV=140)
 * and Outro (middle-centered) are unaffected -- neither sits in TikTok's
 * bottom UI strip.
 */
const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Poppins ExtraBold,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,6,2,2,80,80,320,1
Style: Hook,Poppins ExtraBold,74,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,6,2,2,80,80,320,1
Style: SceneLabel,Poppins ExtraBold,48,&H00F4F6FA,&H00F4F6FA,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,2,8,80,80,140,1
Style: Outro,Poppins ExtraBold,92,&H00EED322,&H00EED322,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,7,3,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

export interface SceneLabelCue {
  label: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Assembles the full .ass file: caption dialogue (bottom-safe, per
 * MarginV=320 in the Caption/Hook styles) plus scene-label dialogue (top
 * third, MarginV=140 in the SceneLabel style) so the two never overlap --
 * preserving TikTok/Shorts UI safe zones (avoids the bottom
 * caption/engagement-bar area and the very top status-bar area).
 *
 * A caption cue's `text` is already fully-formed ASS markup (see
 * buildWordHighlightCues) -- interpolated directly, not re-escaped, since
 * re-escaping would strip the inline colour override braces it depends on.
 */
export function buildAssFile(captionCues: CaptionCue[], sceneLabelCues: SceneLabelCue[]): string {
  const captionLines = captionCues.map(
    (cue) => `Dialogue: 0,${secondsToAssTime(cue.startSeconds)},${secondsToAssTime(cue.endSeconds)},${cue.style},,0,0,0,,${cue.text}`,
  );
  const sceneLines = sceneLabelCues.map(
    (cue) =>
      `Dialogue: 1,${secondsToAssTime(cue.startSeconds)},${secondsToAssTime(cue.endSeconds)},SceneLabel,,0,0,0,,${escapeAssText(cue.label)}`,
  );
  return [ASS_HEADER, ...sceneLines, ...captionLines].join("\n") + "\n";
}
