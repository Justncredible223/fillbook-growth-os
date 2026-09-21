import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner } from "./processRunner.js";

/**
 * Looks at the actual PICTURE of a downloaded stock clip and rejects the ones that cannot look good on
 * screen. The relevance filter in stockFootage.ts only reads the clip's title/tags, so a clip described as
 * "trader" or "stock chart" could still be a solid bright-green screen with a paper icon or an empty white
 * frame -- both reached a real render (2026-09-20) and sat there for a scene each.
 *
 * Deliberately cheap and conservative: a few tiny frames from the start of the clip (that is the part a
 * scene uses), and only four unambiguous failures, so a legitimate bright office or a dark trading room is
 * never thrown away:
 *   - mostly white / washed out   (average brightness very high)
 *   - mostly black                (average brightness very low)
 *   - chroma-key green screen     (a large share of pure "key" green pixels)
 *   - flat / blank                (almost no variation across the frame)
 * If the frames cannot be read at all the clip is ACCEPTED: this check exists to remove bad clips, and a
 * broken inspector must never remove every clip and leave the video with flat colour cards.
 */

export interface ClipVerdict {
  ok: boolean;
  /** Why it was rejected, or a short note when accepted. */
  reason: string;
}

/** Sample size: 32x18 keeps the frames tiny (1.7 KB each) while still showing large flat regions clearly. */
export const SAMPLE_WIDTH = 32;
export const SAMPLE_HEIGHT = 18;
const FRAME_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3;
/** Frames sampled, taken twice a second from the start of the clip. */
export const SAMPLE_FRAMES = 8;

/** Average brightness (0-255) above which a clip counts as washed out / blank white. */
export const WHITE_LUMA_THRESHOLD = 215;
/** Average brightness below which a clip counts as black. */
export const BLACK_LUMA_THRESHOLD = 8;
/** Average share of pure key-green pixels above which a clip counts as a green screen. */
export const GREEN_SHARE_THRESHOLD = 0.3;
/** Average per-frame brightness spread (standard deviation) below which a clip counts as flat. */
export const FLAT_STDDEV_THRESHOLD = 7;
/**
 * A clip is only called flat when it is also at least this bright. A dark trading screen or night-time desk
 * is mostly dark pixels, so it naturally has a small spread and must not be mistaken for a blank frame.
 */
export const FLAT_MIN_LUMA = 40;
/** Fewer decoded frames than this and there is not enough to judge, so the clip is accepted. */
const MIN_FRAMES_TO_JUDGE = 2;

interface FrameStats {
  meanLuma: number;
  stdLuma: number;
  greenShare: number;
}

function frameStats(frame: Buffer): FrameStats {
  const pixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  const lumas = new Array<number>(pixels);
  let sum = 0;
  let green = 0;
  for (let i = 0; i < pixels; i++) {
    const r = frame[i * 3]!;
    const g = frame[i * 3 + 1]!;
    const b = frame[i * 3 + 2]!;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    lumas[i] = luma;
    sum += luma;
    // Key green: strongly green and clearly greener than red and blue, the flat colour used for chroma-key.
    if (g >= 150 && r <= 130 && b <= 130 && g > r * 1.5 && g > b * 1.5) green++;
  }
  const mean = sum / pixels;
  let variance = 0;
  for (const luma of lumas) variance += (luma - mean) ** 2;
  return { meanLuma: mean, stdLuma: Math.sqrt(variance / pixels), greenShare: green / pixels };
}

/** Judges raw RGB24 frames (SAMPLE_WIDTH x SAMPLE_HEIGHT each, back to back). Pure, so it is unit-testable without ffmpeg. */
export function assessClipFrames(raw: Buffer): ClipVerdict {
  const frameCount = Math.floor(raw.length / FRAME_BYTES);
  if (frameCount < MIN_FRAMES_TO_JUDGE) return { ok: true, reason: "too few frames to judge" };

  const stats: FrameStats[] = [];
  for (let i = 0; i < frameCount; i++) stats.push(frameStats(raw.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES)));
  const avg = (pick: (s: FrameStats) => number) => stats.reduce((sum, s) => sum + pick(s), 0) / stats.length;

  const meanLuma = avg((s) => s.meanLuma);
  const greenShare = avg((s) => s.greenShare);
  const stdLuma = avg((s) => s.stdLuma);

  if (greenShare > GREEN_SHARE_THRESHOLD) return { ok: false, reason: `chroma-key green screen (${Math.round(greenShare * 100)}% key green)` };
  if (meanLuma > WHITE_LUMA_THRESHOLD) return { ok: false, reason: `mostly white / washed out (average brightness ${Math.round(meanLuma)})` };
  if (meanLuma < BLACK_LUMA_THRESHOLD) return { ok: false, reason: `mostly black (average brightness ${Math.round(meanLuma)})` };
  if (stdLuma < FLAT_STDDEV_THRESHOLD && meanLuma >= FLAT_MIN_LUMA) return { ok: false, reason: `flat / blank frame (brightness spread ${stdLuma.toFixed(1)})` };
  return { ok: true, reason: "ok" };
}

/**
 * Decodes a few tiny frames from the start of `clipPath` with ffmpeg and judges them. `workDir` gets one
 * short-lived raw file (deleted afterwards). Any failure to inspect accepts the clip -- see the file comment.
 */
export async function inspectClip(clipPath: string, runner: ProcessRunner, workDir: string): Promise<ClipVerdict> {
  const rawPath = join(workDir, `clip-sample-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.raw`);
  try {
    const result = await runner.run("ffmpeg", [
      "-v", "error",
      "-t", "4",
      "-i", clipPath,
      "-vf", `fps=2,scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`,
      "-frames:v", String(SAMPLE_FRAMES),
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-y", rawPath,
    ]);
    if (result.exitCode !== 0) return { ok: true, reason: `could not inspect (ffmpeg exit ${result.exitCode})` };
    return assessClipFrames(readFileSync(rawPath));
  } catch (err) {
    return { ok: true, reason: `could not inspect (${(err as Error).message})` };
  } finally {
    try {
      rmSync(rawPath, { force: true });
    } catch {
      // A leftover 14 KB temp file in a per-render directory is harmless.
    }
  }
}
