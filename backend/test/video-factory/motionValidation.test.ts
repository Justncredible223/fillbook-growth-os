import { describe, it, expect } from "vitest";
import {
  assessMotion,
  checkCropBounds,
  checkPrivacyMaskCoverage,
  checkCaptionOverflow,
  checkOutputDimensions,
  checkSceneTimingVsNarration,
  buildMotionReport,
  SAMPLE_WIDTH,
  SAMPLE_HEIGHT,
} from "../../scripts/video-factory/motionValidation";

const FRAME_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT * 3;

function solidFrame(value: number): Buffer {
  return Buffer.alloc(FRAME_BYTES, value);
}

describe("assessMotion", () => {
  it("flags a clip as frozen when every sampled frame is identical", () => {
    const raw = Buffer.concat([solidFrame(100), solidFrame(100), solidFrame(100), solidFrame(100)]);
    const result = assessMotion(raw);
    expect(result.frozen).toBe(true);
    expect(result.nearIdenticalFramePct).toBe(1);
    expect(result.motionScore).toBe(0);
  });

  it("does not flag a clip as frozen when consecutive frames clearly differ", () => {
    const raw = Buffer.concat([solidFrame(20), solidFrame(220), solidFrame(20), solidFrame(220)]);
    const result = assessMotion(raw);
    expect(result.frozen).toBe(false);
    expect(result.motionScore).toBeGreaterThan(0.5);
  });

  it("is not fooled by a single-scene-cut clip that is otherwise static -- a real scroll/hover motion scene needs sustained change, not one jump", () => {
    // One sharp change, then dead flat for the rest -- e.g. a page navigation followed by a frozen scene.
    // 10 frames -> 9 consecutive pairs: 1 differs (the cut), 8 are near-identical -> 89%, over
    // FROZEN_NEAR_IDENTICAL_PCT (0.85), so this correctly reads as frozen despite the one real cut.
    const frames = [solidFrame(20), ...Array.from({ length: 9 }, () => solidFrame(220))];
    const result = assessMotion(Buffer.concat(frames));
    expect(result.frozen).toBe(true);
  });

  it("treats too few samples as insufficient (frozen) rather than guessing", () => {
    const raw = Buffer.concat([solidFrame(20), solidFrame(220)]); // only 2 frames, below MIN_SAMPLES_TO_JUDGE
    const result = assessMotion(raw);
    expect(result.frozen).toBe(true);
    expect(result.sampledFrameCount).toBe(2);
  });

  it("is not fooled by ordinary encoder noise -- small per-pixel jitter under the near-identical threshold still counts as static", () => {
    const a = solidFrame(100);
    const b = Buffer.from(a); // copy, then nudge every byte by 1 -- well under NEAR_IDENTICAL_DIFF_THRESHOLD=2.5
    for (let i = 0; i < b.length; i++) b[i] = 101;
    const raw = Buffer.concat([a, b, a, b]);
    const result = assessMotion(raw);
    expect(result.frozen).toBe(true);
  });
});

describe("checkCropBounds", () => {
  const SOURCE_W = 1080;
  const SOURCE_H = 1920;

  it("passes a crop fully inside the source frame", () => {
    expect(checkCropBounds({ x: 0, y: 0, w: 1080, h: 1920 }, SOURCE_W, SOURCE_H)).toEqual([]);
    expect(checkCropBounds({ x: 100, y: 100, w: 400, h: 300 }, SOURCE_W, SOURCE_H)).toEqual([]);
  });

  it("flags a crop that extends past the right/bottom edge", () => {
    const problems = checkCropBounds({ x: 900, y: 0, w: 300, h: 100 }, SOURCE_W, SOURCE_H);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/extends past the source frame/);
  });

  it("flags a negative origin", () => {
    expect(checkCropBounds({ x: -10, y: 0, w: 100, h: 100 }, SOURCE_W, SOURCE_H)[0]).toMatch(/negative/);
  });

  it("flags a non-positive size", () => {
    expect(checkCropBounds({ x: 0, y: 0, w: 0, h: 100 }, SOURCE_W, SOURCE_H)[0]).toMatch(/non-positive size/);
  });
});

describe("checkPrivacyMaskCoverage", () => {
  it("passes when every private region is fully covered by a mask", () => {
    const privateRegions = [{ region: { x: 10, y: 10, w: 50, h: 20 }, kind: "email" as const }];
    const masks = [{ region: { x: 0, y: 0, w: 200, h: 200 } }];
    expect(checkPrivacyMaskCoverage(privateRegions, masks)).toEqual([]);
  });

  it("flags a private region with no covering mask at all", () => {
    const privateRegions = [{ region: { x: 10, y: 10, w: 50, h: 20 }, kind: "email" as const }];
    const problems = checkPrivacyMaskCoverage(privateRegions, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/email/);
  });

  it("flags a mask that only partially covers the private region -- a mask smaller than what it claims to hide is a leak, not a pass", () => {
    const privateRegions = [{ region: { x: 10, y: 10, w: 50, h: 20 }, kind: "account_id" as const }];
    const masks = [{ region: { x: 10, y: 10, w: 20, h: 20 } }]; // too narrow, doesn't cover the full 50px width
    expect(checkPrivacyMaskCoverage(privateRegions, masks)).toHaveLength(1);
  });
});

describe("checkCaptionOverflow", () => {
  const BOX_W = 900;
  const BOX_H = 260; // roughly two lines at 52px (DEFAULT_FONT.caption) with layout.ts's LINE_HEIGHT_EM

  it("passes a short caption that wraps to a couple of lines within the box", () => {
    expect(checkCaptionOverflow("Which setup is hiding here?", 52, BOX_W, BOX_H)).toEqual([]);
  });

  it("flags a caption whose wrapped line count is taller than the box", () => {
    const longCaption = "This caption has enough words that it needs far more than two wrapped lines to read at this font size and box width";
    const problems = checkCaptionOverflow(longCaption, 52, BOX_W, BOX_H);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/wraps to \d+ lines/);
  });

  it("flags a single word wider than the box, distinctly from a too-many-lines overflow", () => {
    const problems = checkCaptionOverflow("Supercalifragilisticexpialidocious", 52, 100, 260);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/single word is wider/);
  });
});

describe("checkOutputDimensions", () => {
  it("passes the required 1080x1920 @30fps", () => {
    expect(checkOutputDimensions(1080, 1920, 30)).toEqual([]);
  });

  it("flags a wrong viewport and/or fps", () => {
    const problems = checkOutputDimensions(1920, 1080, 24);
    expect(problems).toHaveLength(2);
  });
});

describe("checkSceneTimingVsNarration", () => {
  it("passes a scene with enough time for its narration", () => {
    expect(checkSceneTimingVsNarration(5, "Ten short words go here for this narration line today")).toEqual([]);
  });

  it("flags a scene that is too short for its narration", () => {
    const problems = checkSceneTimingVsNarration(1, "This narration has far too many words for a one second scene to hold");
    expect(problems).toHaveLength(1);
  });
});

describe("buildMotionReport", () => {
  const baseParams = {
    sceneId: "test-scene",
    durationSeconds: 8,
    crop: { x: 0, y: 0, w: 1080, h: 1920 },
    sourceWidth: 1080,
    sourceHeight: 1920,
    focalRegion: null,
    captionText: "Short caption",
    captionFontSizePx: 36,
    privateRegions: [],
    masks: [],
    narration: "Short narration line",
    captureWidth: 1080,
    captureHeight: 1920,
    captureFps: 30,
    fallbackUsed: false,
  };

  it("is sufficient when motion is real and every structural check passes", () => {
    const report = buildMotionReport({
      ...baseParams,
      motion: { motionScore: 0.5, nearIdenticalFramePct: 0.5, frozen: false, sampledFrameCount: 20 },
    });
    expect(report.sufficient).toBe(true);
  });

  it("a scene that only zooms/pans on a frozen source is flagged insufficient, even with zero structural problems -- the whole point of this checker", () => {
    const report = buildMotionReport({
      ...baseParams,
      motion: { motionScore: 0.05, nearIdenticalFramePct: 0.95, frozen: true, sampledFrameCount: 20 },
    });
    expect(report.sufficient).toBe(false);
    expect(report.motion.frozen).toBe(true);
  });

  it("is insufficient when the fallback (still image) was used, even if the source clip itself would have passed", () => {
    const report = buildMotionReport({
      ...baseParams,
      motion: { motionScore: 0.5, nearIdenticalFramePct: 0.5, frozen: false, sampledFrameCount: 20 },
      fallbackUsed: true,
    });
    expect(report.sufficient).toBe(false);
    expect(report.fallbackUsed).toBe(true);
  });

  it("is insufficient when a privacy region is uncovered, regardless of motion quality", () => {
    const report = buildMotionReport({
      ...baseParams,
      motion: { motionScore: 0.5, nearIdenticalFramePct: 0.5, frozen: false, sampledFrameCount: 20 },
      privateRegions: [{ region: { x: 5, y: 5, w: 10, h: 10 }, kind: "email" }],
      masks: [],
    });
    expect(report.sufficient).toBe(false);
    expect(report.privacyProblems).toHaveLength(1);
  });
});
