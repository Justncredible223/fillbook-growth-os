import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessClipFrames,
  inspectClip,
  SAMPLE_FRAMES,
  SAMPLE_HEIGHT,
  SAMPLE_WIDTH,
} from "../../scripts/video-factory/clipQuality";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const PIXELS = SAMPLE_WIDTH * SAMPLE_HEIGHT;

/** One raw RGB24 frame filled by a per-pixel function. */
function frame(pixel: (index: number) => [number, number, number]): Buffer {
  const buf = Buffer.alloc(PIXELS * 3);
  for (let i = 0; i < PIXELS; i++) {
    const [r, g, b] = pixel(i);
    buf[i * 3] = r;
    buf[i * 3 + 1] = g;
    buf[i * 3 + 2] = b;
  }
  return buf;
}

const repeat = (f: Buffer, times = 4) => Buffer.concat(Array.from({ length: times }, () => f));
/** A varied, mid-brightness picture (a busy chart or a person at a desk): no flat regions. */
const busy = (seed = 0) => frame((i) => [40 + ((i * 37 + seed) % 120), 40 + ((i * 53 + seed) % 120), 50 + ((i * 29 + seed) % 100)]);

describe("assessClipFrames -- the four unambiguous failures", () => {
  it("rejects a solid chroma-key green screen (the paper-icon clip that reached a real render)", () => {
    // 78% key green like the real clip, with a grey icon in the middle.
    const greenScreen = frame((i) => (i % 9 < 7 ? [76, 214, 58] : [200, 200, 200]));
    const verdict = assessClipFrames(repeat(greenScreen));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("green screen");
  });

  it("rejects a blank, washed-out white frame (the empty scene that reached a real render)", () => {
    const verdict = assessClipFrames(repeat(frame(() => [236, 236, 236])));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("white");
  });

  it("rejects a mostly black clip", () => {
    const verdict = assessClipFrames(repeat(frame(() => [2, 2, 2])));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("black");
  });

  it("rejects a flat mid-grey frame that is neither white nor black", () => {
    const verdict = assessClipFrames(repeat(frame(() => [120, 120, 120])));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("flat");
  });

  it("rejects a flat light-grey blank that is just under the white cut-off", () => {
    const verdict = assessClipFrames(repeat(frame(() => [205, 205, 205])));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("flat");
  });
});

describe("assessClipFrames -- legitimate footage is kept", () => {
  it("accepts a normal busy picture", () => {
    expect(assessClipFrames(repeat(busy())).ok).toBe(true);
  });

  it("does not call a dark, low-contrast clip flat: it is mostly dark pixels by nature", () => {
    const dimScreen = frame((i) => [14 + (i % 6), 16 + (i % 5), 20 + (i % 7)]);
    expect(assessClipFrames(repeat(dimScreen)).ok).toBe(true);
  });

  it("accepts a dark but detailed trading-room clip (average brightness near 20)", () => {
    const dark = frame((i) => [8 + (i % 30), 10 + ((i * 7) % 30), 14 + ((i * 3) % 30)]);
    expect(assessClipFrames(repeat(dark)).ok).toBe(true);
  });

  it("accepts a bright office scene that is not blank (average brightness around 190)", () => {
    const bright = frame((i) => [150 + ((i * 11) % 80), 150 + ((i * 17) % 80), 150 + ((i * 5) % 80)]);
    expect(assessClipFrames(repeat(bright)).ok).toBe(true);
  });

  it("accepts a chart with green candles when green is only a small share of the picture", () => {
    const chart = frame((i) => (i % 12 === 0 ? [60, 200, 70] : [20 + ((i * 13) % 60), 25 + ((i * 7) % 60), 40 + ((i * 3) % 60)]));
    expect(assessClipFrames(repeat(chart)).ok).toBe(true);
  });

  it("judges the clip across all its frames, not one: a single blank frame in a real clip does not reject it", () => {
    const frames = Buffer.concat([busy(1), busy(2), busy(3), frame(() => [240, 240, 240]), busy(4), busy(5), busy(6), busy(7)]);
    expect(assessClipFrames(frames).ok).toBe(true);
  });

  it("accepts when there are too few frames to judge, instead of guessing", () => {
    expect(assessClipFrames(busy()).ok).toBe(true);
    expect(assessClipFrames(Buffer.alloc(0)).ok).toBe(true);
  });
});

describe("inspectClip", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A runner that behaves like ffmpeg: writes `raw` to the last argument (the output file). */
  const runnerWriting = (raw: Buffer, exitCode = 0): ProcessRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    return {
      calls,
      async run(_command, args) {
        calls.push(args);
        writeFileSync(args[args.length - 1]!, raw);
        return { stdout: "", stderr: "", exitCode };
      },
    };
  };

  it("asks ffmpeg for a few tiny frames from the start of the clip and judges them", async () => {
    dir = mkdtempSync(join(tmpdir(), "clip-quality-"));
    const runner = runnerWriting(repeat(frame(() => [236, 236, 236]), SAMPLE_FRAMES));

    const verdict = await inspectClip("C:/clips/pexels-1.mp4", runner, dir);

    expect(verdict.ok).toBe(false);
    const args = runner.calls[0]!;
    expect(args).toContain("C:/clips/pexels-1.mp4");
    expect(args.join(" ")).toContain(`scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`);
    expect(args).toContain("rgb24");
  });

  it("removes its temporary file", async () => {
    dir = mkdtempSync(join(tmpdir(), "clip-quality-"));
    await inspectClip("clip.mp4", runnerWriting(repeat(busy(), SAMPLE_FRAMES)), dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("accepts a clip it cannot inspect (ffmpeg fails) rather than throwing every clip away", async () => {
    dir = mkdtempSync(join(tmpdir(), "clip-quality-"));
    const verdict = await inspectClip("clip.mp4", runnerWriting(Buffer.alloc(0), 1), dir);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("could not inspect");
  });

  it("accepts a clip when the runner throws", async () => {
    dir = mkdtempSync(join(tmpdir(), "clip-quality-"));
    const throwing: ProcessRunner = {
      async run() {
        throw new Error("spawn ffmpeg ENOENT");
      },
    };
    const verdict = await inspectClip("clip.mp4", throwing, dir);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("ENOENT");
  });
});
