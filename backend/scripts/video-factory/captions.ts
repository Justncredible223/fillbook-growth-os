import type { CaptionCue } from "./types.js";

/**
 * Real per-sentence timing from edge-tts's own --write-subtitles output
 * (see docs/VIDEO_FACTORY.md's audit notes) -- preferred over any
 * duration-based guess, per the spec's "if reliable timing metadata is
 * available locally, use it." edge-tts's SRT cues are already
 * sentence-chunked in practice, which lines up naturally with comfortable
 * caption pacing without any extra work.
 */
export interface SrtCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

function parseSrtTime(raw: string): number {
  const m = SRT_TIME.exec(raw);
  if (!m) throw new Error(`Malformed SRT timestamp: "${raw}"`);
  const [, hh, mm, ss, ms] = m;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

/** Parses edge-tts's --write-subtitles .srt output into cues. */
export function parseSrt(content: string): SrtCue[] {
  const blocks = content.replace(/\r\n/g, "\n").trim().split(/\n\n+/).filter((b) => b.trim().length > 0);
  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const index = Number(lines[0]);
    const timeLine = lines[1] ?? "";
    const [startRaw, endRaw] = timeLine.split("-->").map((s) => s.trim());
    if (!startRaw || !endRaw) continue;
    const text = lines.slice(2).join(" ").trim();
    if (!text) continue;
    cues.push({
      index: Number.isFinite(index) ? index : cues.length + 1,
      startSeconds: parseSrtTime(startRaw),
      endSeconds: parseSrtTime(endRaw),
      text,
    });
  }
  return cues;
}

// Sized against real sentence lengths from the Day 1 script (see
// ~/fillbookhq/docs/social/SEPT1_TIKTOK_PRODUCTION_PACKAGE.md), not
// picked arbitrarily -- most ordinary sentences (50-70 chars) should
// pass through as a single readable caption at 1080px/64pt; this only
// exists to catch genuinely long run-ons.
const MAX_CHARS_PER_CAPTION = 70;

/**
 * Splits an oversized SRT cue into readable sub-segments, timed
 * proportionally to each segment's share of the cue's character count --
 * a deterministic approximation of speech rate within that cue's REAL
 * (not guessed) time window. Most cues from edge-tts are already short
 * sentences and pass through untouched; this only fires for a genuinely
 * long sentence. Splits on clause boundaries (commas) before falling back
 * to a straight word-count split, so a break never lands mid-phrase.
 */
function splitOversizedCue(cue: SrtCue): Array<{ text: string; startSeconds: number; endSeconds: number }> {
  if (cue.text.length <= MAX_CHARS_PER_CAPTION) {
    return [{ text: cue.text, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds }];
  }

  const clauses = cue.text.split(/(?<=,)\s+/).filter((c) => c.length > 0);
  const segments = clauses.length > 1 ? clauses : cue.text.split(/\s+/);

  const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
  const duration = cue.endSeconds - cue.startSeconds;
  const result: Array<{ text: string; startSeconds: number; endSeconds: number }> = [];

  // Group word-level segments back into ~MAX_CHARS_PER_CAPTION chunks
  // rather than one caption per word.
  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    const candidate = current ? `${current} ${segment}` : segment;
    if (candidate.length > MAX_CHARS_PER_CAPTION && current) {
      chunks.push(current);
      current = segment;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  let elapsed = 0;
  for (const chunk of chunks) {
    const share = totalChars > 0 ? chunk.length / totalChars : 1 / chunks.length;
    const chunkDuration = duration * share;
    result.push({
      text: chunk.trim(),
      startSeconds: cue.startSeconds + elapsed,
      endSeconds: cue.startSeconds + elapsed + chunkDuration,
    });
    elapsed += chunkDuration;
  }
  return result;
}

/**
 * Builds the final caption cue list: real SRT timing as the backbone,
 * oversized cues split deterministically, and the first cue tagged as
 * the "Hook" style. Position alone determines styling -- the hook is
 * always spoken first, by construction (videoScriptWriter puts it at
 * the start of `script`).
 */
export function buildCaptionCues(srtCues: SrtCue[]): CaptionCue[] {
  const expanded = srtCues.flatMap(splitOversizedCue);
  return expanded.map((seg, i) => ({
    text: seg.text,
    startSeconds: seg.startSeconds,
    endSeconds: seg.endSeconds,
    style: i === 0 ? ("Hook" as const) : ("Caption" as const),
  }));
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
 * Escapes text for a literal ASS Dialogue line. `{`/`}` open override
 * blocks in ASS -- stripping them (never expected in real caption text)
 * is simpler and safer than trying to escape-and-preserve them. Newlines
 * become `\N`, ASS's hard line break.
 */
export function escapeAssText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\r\n|\n/g, "\\N");
}

/**
 * Known-good header from ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md,
 * preserved verbatim: PlayResX/PlayResY MUST match the render resolution
 * (this is what fixed the libass clipping bug), Alignment=5 (middle-center)
 * avoids margin-from-edge ambiguity, and Hook uses brand cyan #22D3EE
 * (stored BGR in ASS: &H00EED322). A third "SceneLabel" style (see
 * scenes.ts) reuses the same subtitles-filter mechanism for on-screen
 * scene text, since drawtext segfaults on this ffmpeg build.
 */
const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,0,2,80,80,160,1
Style: Hook,Verdana,72,&H00EED322,&H00EED322,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,5,0,2,80,80,160,1
Style: SceneLabel,Verdana,48,&H00F4F6FA,&H00F4F6FA,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,4,0,8,80,80,140,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

export interface SceneLabelCue {
  label: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Assembles the full .ass file: caption dialogue (bottom-safe, per
 * MarginV=80 in the Caption/Hook styles) plus scene-label dialogue (top
 * third, MarginV=140 in the SceneLabel style) so the two never overlap --
 * preserving TikTok/Shorts UI safe zones (avoids the bottom
 * caption/engagement-bar area and the very top status-bar area).
 */
export function buildAssFile(captionCues: CaptionCue[], sceneLabelCues: SceneLabelCue[]): string {
  const captionLines = captionCues.map(
    (cue) =>
      `Dialogue: 0,${secondsToAssTime(cue.startSeconds)},${secondsToAssTime(cue.endSeconds)},${cue.style},,0,0,0,,${escapeAssText(cue.text)}`,
  );
  const sceneLines = sceneLabelCues.map(
    (cue) =>
      `Dialogue: 1,${secondsToAssTime(cue.startSeconds)},${secondsToAssTime(cue.endSeconds)},SceneLabel,,0,0,0,,${escapeAssText(cue.label)}`,
  );
  return [ASS_HEADER, ...sceneLines, ...captionLines].join("\n") + "\n";
}
