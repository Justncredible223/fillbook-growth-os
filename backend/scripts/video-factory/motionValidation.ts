import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner } from "./processRunner.js";
import type { Rect, PrivateRegion, Mask } from "../../src/shortform/types.js";
import { textOverflows, estimateLines, layoutBoxes } from "../../src/shortform/layout.js";

/**
 * Judges whether a captured `screen_recording` clip actually MOVES, the way
 * clipQuality.ts already judges whether a stock clip's PICTURE is usable.
 * Same reasoning as that file's own doc comment, extended from "is this a
 * good picture" to "does this picture actually change over time" -- a scene
 * that only applies a zoom/pan to a frozen or near-identical source is not
 * a real motion capture, it is Ken Burns on a screenshot, and must be
 * flagged as insufficient rather than silently accepted (see this repo's
 * own retired-thumbnail-frame-grab incident, 2026-09-22, for why "looks
 * plausible in code" is not the same as "verified against real output").
 *
 * Deliberately reuses clipQuality.ts's exact sampling shape (tiny RGB24
 * frames, decoded once, judged in pure TypeScript) so both modules can be
 * reasoned about the same way and unit-tested without ffmpeg.
 */

export const SAMPLE_WIDTH = 32;
export const SAMPLE_HEIGHT = 18;
const FRAME_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3;
/** One sample every 0.5s -- enough to catch a scroll/expand animation without over-sampling a short clip. */
export const SAMPLE_FPS = 2;

/**
 * Mean per-pixel luma difference (0-255 scale) between two consecutive
 * sampled frames counts as "near-identical" below this. Chosen well above
 * ordinary video noise/compression dither (which sits under ~1) so a
 * genuinely static frame isn't flagged just for encoder noise, but well
 * below what any real scroll, hover-highlight, or tab switch produces.
 */
export const NEAR_IDENTICAL_DIFF_THRESHOLD = 2.5;
/** A clip whose near-identical frame-pair share is at or above this is frozen -- no real motion happened. */
export const FROZEN_NEAR_IDENTICAL_PCT = 0.85;
/** Below MIN_SAMPLES there isn't enough to judge motion at all -- same "accept rather than falsely reject" posture as clipQuality.ts. */
const MIN_SAMPLES_TO_JUDGE = 3;

export interface MotionScoreResult {
  /** 0 (no detectable change between any sampled frame pair) to 1 (every pair changed sharply). */
  motionScore: number;
  /** Share of consecutive frame pairs below NEAR_IDENTICAL_DIFF_THRESHOLD. */
  nearIdenticalFramePct: number;
  /** True when nearIdenticalFramePct >= FROZEN_NEAR_IDENTICAL_PCT -- this clip does not qualify as a motion scene. */
  frozen: boolean;
  sampledFrameCount: number;
}

function meanAbsDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / n;
}

/** Judges raw RGB24 frames (SAMPLE_WIDTH x SAMPLE_HEIGHT each, back to back, in capture order). Pure, unit-testable without ffmpeg. */
export function assessMotion(raw: Buffer): MotionScoreResult {
  const frameCount = Math.floor(raw.length / FRAME_BYTES);
  if (frameCount < MIN_SAMPLES_TO_JUDGE) {
    return { motionScore: 0, nearIdenticalFramePct: 1, frozen: true, sampledFrameCount: frameCount };
  }

  const diffs: number[] = [];
  for (let i = 1; i < frameCount; i++) {
    const prev = raw.subarray((i - 1) * FRAME_BYTES, i * FRAME_BYTES);
    const cur = raw.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES);
    diffs.push(meanAbsDiff(prev, cur));
  }

  const nearIdenticalCount = diffs.filter((d) => d < NEAR_IDENTICAL_DIFF_THRESHOLD).length;
  const nearIdenticalFramePct = nearIdenticalCount / diffs.length;
  // Normalize against a generous 40/255 per-pixel-channel average diff as "clearly moving" -- picked well
  // above what a highlight/hover produces and well below a hard scene cut, so motionScore reads as a
  // continuous "how much did this actually change" rather than saturating on any real interaction.
  const avgDiff = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const motionScore = Math.min(1, avgDiff / 40);

  return {
    motionScore,
    nearIdenticalFramePct,
    frozen: nearIdenticalFramePct >= FROZEN_NEAR_IDENTICAL_PCT,
    sampledFrameCount: frameCount,
  };
}

/** Decodes evenly-spaced tiny frames across the WHOLE clip duration (not just the start, unlike clipQuality.ts's inspectClip -- a motion scene's movement can happen anywhere in the window) and judges them. Any failure to inspect returns `frozen: true`: unlike a stock-clip picture check, an unreadable motion capture must never be silently accepted as "moving." */
export async function inspectClipMotion(clipPath: string, durationSeconds: number, runner: ProcessRunner, workDir: string): Promise<MotionScoreResult> {
  const rawPath = join(workDir, `motion-sample-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.raw`);
  try {
    const result = await runner.run("ffmpeg", [
      "-v", "error",
      "-i", clipPath,
      "-vf", `fps=${SAMPLE_FPS},scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`,
      "-frames:v", String(Math.max(MIN_SAMPLES_TO_JUDGE, Math.round(durationSeconds * SAMPLE_FPS))),
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-y", rawPath,
    ]);
    if (result.exitCode !== 0) {
      return { motionScore: 0, nearIdenticalFramePct: 1, frozen: true, sampledFrameCount: 0 };
    }
    return assessMotion(readFileSync(rawPath));
  } catch {
    return { motionScore: 0, nearIdenticalFramePct: 1, frozen: true, sampledFrameCount: 0 };
  } finally {
    try {
      rmSync(rawPath, { force: true });
    } catch {
      // A leftover raw sample file is harmless.
    }
  }
}

// ---------------------------------------------------------------------
// Structural checks -- pure functions over plan/spec data, no ffmpeg.
// Each returns a list of human-readable problem strings (empty = passes).
// ---------------------------------------------------------------------

/** A scene's crop must sit entirely inside the source frame -- an out-of-bounds crop is what "unreadable source text" and edge artifacts usually turn out to be. */
export function checkCropBounds(crop: Rect, sourceWidth: number, sourceHeight: number): string[] {
  const problems: string[] = [];
  if (crop.x < 0 || crop.y < 0) problems.push(`crop origin (${crop.x}, ${crop.y}) is negative`);
  if (crop.w <= 0 || crop.h <= 0) problems.push(`crop has non-positive size (${crop.w}x${crop.h})`);
  if (crop.x + crop.w > sourceWidth || crop.y + crop.h > sourceHeight) {
    problems.push(`crop (${crop.x},${crop.y} ${crop.w}x${crop.h}) extends past the source frame (${sourceWidth}x${sourceHeight})`);
  }
  return problems;
}

/** Every declared private region must be fully covered by at least one mask -- a mask that's smaller than or offset from the region it's meant to hide is a privacy leak, not a formality. */
export function checkPrivacyMaskCoverage(privateRegions: PrivateRegion[], masks: Mask[]): string[] {
  const problems: string[] = [];
  const contains = (outer: Rect, inner: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  for (const pr of privateRegions) {
    const covered = masks.some((m) => contains(m.region, pr.region));
    if (!covered) problems.push(`private region (${pr.kind} at ${pr.region.x},${pr.region.y} ${pr.region.w}x${pr.region.h}) is not fully covered by any mask`);
  }
  return problems;
}

/**
 * Delegates to src/shortform/layout.ts's textOverflows/wrapText -- the
 * SAME measured word-wrap system validateSceneText and buildSceneAss both
 * already use, not a second, cruder single-line-only heuristic (an earlier
 * version of this function invented its own average-glyph-width estimate
 * and only ever checked one line; that duplicated worse logic instead of
 * reusing the shortform pipeline's real one, and a caption that "passed"
 * it could still overflow the real 2-line caption box). Never suggests
 * shrinking the font to fix an overflow -- that is a copy-authoring
 * decision, reported here as a fact, not silently applied.
 */
export function checkCaptionOverflow(captionText: string, fontSizePx: number, boxWidth: number, boxHeight: number): string[] {
  const box = { x: 0, y: 0, w: boxWidth, h: boxHeight };
  if (!textOverflows(captionText, fontSizePx, box)) return [];
  const { lines, wordTooWide } = estimateLines(captionText, fontSizePx, boxWidth);
  const reason = wordTooWide
    ? "a single word is wider than the caption box at this font size"
    : `wraps to ${lines} lines, taller than the ${boxHeight}px caption box at ${fontSizePx}px`;
  return [`caption "${captionText.slice(0, 40)}${captionText.length > 40 ? "…" : ""}" overflows: ${reason}`];
}

/** Primary output contract (render.ts's WIDTH/HEIGHT/FRAME_RATE) -- a motion clip captured at the wrong viewport can't be composited without an unplanned scale/crop that would fight the scene's own crop rect. */
export function checkOutputDimensions(width: number, height: number, fps: number): string[] {
  const problems: string[] = [];
  if (width !== 1080 || height !== 1920) problems.push(`viewport ${width}x${height} is not the required 1080x1920 primary output size`);
  if (fps !== 30) problems.push(`capture fps ${fps} is not the required 30`);
  return problems;
}

/** A scene's on-screen duration must give the narration enough time to be heard -- reusing the same rough words-per-second budget captions.ts's phrase pacing already assumes (~2.5 words/sec spoken). Too short and the clip cuts away mid-sentence; this doesn't fail loudly, so it's a distinct, explicit check. */
const APPROX_WORDS_PER_SECOND = 2.5;
export function checkSceneTimingVsNarration(durationSeconds: number, narration: string): string[] {
  const wordCount = narration.trim().split(/\s+/).filter(Boolean).length;
  const neededSeconds = wordCount / APPROX_WORDS_PER_SECOND;
  if (durationSeconds < neededSeconds - 0.5) {
    return [`scene is ${durationSeconds.toFixed(1)}s but its narration ("${narration.slice(0, 40)}${narration.length > 40 ? "…" : ""}") needs roughly ${neededSeconds.toFixed(1)}s at natural pace`];
  }
  return [];
}

export interface MotionReport {
  sceneId: string;
  durationSeconds: number;
  motion: MotionScoreResult;
  focalRegion: Rect | null;
  cropProblems: string[];
  captionOverflowProblems: string[];
  privacyProblems: string[];
  dimensionProblems: string[];
  timingProblems: string[];
  /** Overall pass/fail -- a scene only counts as a real motion capture when it's not frozen AND has no structural problems. */
  sufficient: boolean;
  fallbackUsed: boolean;
}

/** Assembles one scene's full motion report from the individual checks above -- the single object previewPlans.ts writes to disk per scene. */
export function buildMotionReport(params: {
  sceneId: string;
  durationSeconds: number;
  motion: MotionScoreResult;
  crop: Rect | null;
  sourceWidth: number;
  sourceHeight: number;
  focalRegion: Rect | null;
  captionText: string;
  captionFontSizePx: number;
  privateRegions: PrivateRegion[];
  masks: Mask[];
  narration: string;
  captureWidth: number;
  captureHeight: number;
  captureFps: number;
  fallbackUsed: boolean;
}): MotionReport {
  const cropProblems = params.crop ? checkCropBounds(params.crop, params.sourceWidth, params.sourceHeight) : [];
  const captionBox = layoutBoxes("tiktok").caption;
  const captionOverflowProblems = checkCaptionOverflow(params.captionText, params.captionFontSizePx, captionBox.w, captionBox.h);
  const privacyProblems = checkPrivacyMaskCoverage(params.privateRegions, params.masks);
  const dimensionProblems = checkOutputDimensions(params.captureWidth, params.captureHeight, params.captureFps);
  const timingProblems = checkSceneTimingVsNarration(params.durationSeconds, params.narration);

  const sufficient =
    !params.fallbackUsed &&
    !params.motion.frozen &&
    cropProblems.length === 0 &&
    captionOverflowProblems.length === 0 &&
    privacyProblems.length === 0 &&
    dimensionProblems.length === 0 &&
    timingProblems.length === 0;

  return {
    sceneId: params.sceneId,
    durationSeconds: params.durationSeconds,
    motion: params.motion,
    focalRegion: params.focalRegion,
    cropProblems,
    captionOverflowProblems,
    privacyProblems,
    dimensionProblems,
    timingProblems,
    sufficient,
    fallbackUsed: params.fallbackUsed,
  };
}
