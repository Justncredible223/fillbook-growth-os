import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFfmpegArgs,
  renderBasename,
  renderDirname,
  renderVideo,
  extractThumbnail,
  computeSceneTransitions,
  computeSyncedSceneTimeline,
} from "../../scripts/video-factory/render";
import { VideoFactoryError, type RenderPlan } from "../../scripts/video-factory/types";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const plan: RenderPlan = {
  scenes: [
    { kind: "hook", label: "", durationSeconds: 5, backgroundColor: "0x05070a" },
    { kind: "product", label: "FILLBOOK", durationSeconds: 5, backgroundColor: "0x0d1420" },
  ],
  totalDurationSeconds: 10,
  voiceoverPath: "C:\\out\\draft-1\\voiceover.mp3",
  assPath: "C:\\out\\draft-1\\captions.ass",
  outputPath: "C:\\out\\draft-1\\final.mp4",
  silencePadSeconds: 2.5,
};

describe("buildFfmpegArgs", () => {
  it("references voiceover/captions/output by basename only (no unescaped Windows paths in the filter graph)", () => {
    const args = buildFfmpegArgs(plan);
    const joined = args.join(" ");
    expect(joined).toContain("voiceover.mp3");
    expect(joined).toContain("captions.ass");
    expect(joined).toContain("final.mp4");
    expect(joined).not.toContain("C:\\out");
  });

  it("builds one lavfi color input per scene with the right color/duration", () => {
    const args = buildFfmpegArgs(plan);
    // Every scene but the last runs a transition-length (0.4s) past its
    // planned duration so the crossfade lands on the planned cut time.
    expect(args).toContain("color=c=0x05070a:s=1080x1920:d=5.400:r=30");
    expect(args).toContain("color=c=0x0d1420:s=1080x1920:d=5.000:r=30");
  });

  it("crossfades adjacent scene video inputs (no hard cut) before applying subtitles", () => {
    const args = buildFfmpegArgs(plan);
    const filterIndex = args.indexOf("-filter_complex");
    const filter = args[filterIndex + 1]!;
    // Both scenes are 5s -> transition duration caps at MAX_TRANSITION_SECONDS (0.4),
    // and the fade starts exactly at the planned cut (5.0s), not 0.4s early.
    expect(filter).toContain("[sv0][sv1]xfade=transition=fade:duration=0.400:offset=5.000[xf0]");
    expect(filter).toContain("[xf0]subtitles=captions.ass:fontsdir=.[v]");
  });

  it("concatenates voiceover + silence pad, ducks the music under the voice, mixes, then loudness-normalises", () => {
    const args = buildFfmpegArgs(plan);
    const filterIndex = args.indexOf("-filter_complex");
    const filter = args[filterIndex + 1]!;
    // scenes.length = 2 -> voiceover is input 2, silence is input 3, music is input 4
    expect(filter).toContain("[2:a][3:a]concat=n=2:v=0:a=1[voicefull]");
    expect(args).toContain("anullsrc=r=24000:cl=mono:d=2.500");
    expect(filter).toContain("[voicefull]asplit=2[voice][voicesc]");
    expect(filter).toContain("[4:a]volume=0.2[musicvol]");
    expect(filter).toContain("[musicvol][voicesc]sidechaincompress=threshold=0.06:ratio=4:attack=15:release=350[musicduck]");
    expect(filter).toContain("[voice][musicduck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]");
    expect(filter).toContain("[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]");
  });

  it("loops and trims the bundled music track to the plan's total duration, referenced by basename", () => {
    const args = buildFfmpegArgs(plan);
    const joined = args.join(" ");
    expect(joined).toContain("-stream_loop -1 -t 10.000 -i ambient-technology.mp3");
  });

  it("uses the known-good codec settings (h264/yuv420p/aac)", () => {
    const args = buildFfmpegArgs(plan);
    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
    expect(args).toContain("aac");
    expect(args).toContain("-shortest");
  });

  it("throws on an empty scene list", () => {
    expect(() => buildFfmpegArgs({ ...plan, scenes: [] })).toThrow(VideoFactoryError);
  });
});

describe("buildFfmpegArgs with UI screenshot scenes", () => {
  const imagePlan: RenderPlan = {
    ...plan,
    scenes: [
      { kind: "hook", label: "", durationSeconds: 5, backgroundColor: "0x05070a" },
      { kind: "product", label: "", durationSeconds: 5, backgroundColor: "0x0d1420", imagePath: "C:\\out\\draft-1\\ui-calendar.jpg" },
    ],
  };

  it("loops the screenshot at the render frame rate for the scene's duration, referenced by basename", () => {
    const args = buildFfmpegArgs(imagePlan);
    expect(args.join(" ")).toContain("-loop 1 -framerate 30 -t 5.000 -i ui-calendar.jpg");
  });

  it("pans a 1080x1270 window down the screenshot between dark label/caption bands and normalises to yuv420p", () => {
    const args = buildFfmpegArgs(imagePlan);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("[1:v]scale=1080:-2,pad=1080:'max(ih,1270)':0:0:color=0x0d1420,");
    expect(filter).toContain("crop=1080:1270:0:'(in_h-1270)*min(t/5.000,1)',pad=1080:1920:0:230:color=0x0d1420,");
    expect(filter).toContain("format=yuv420p,setpts=PTS-STARTPTS[sv1]");
    expect(filter).not.toContain("C:");
  });
});

describe("buildFfmpegArgs hook treatment", () => {
  const clipPlan = (kind: "hook" | "explanation"): RenderPlan => ({
    ...plan,
    scenes: [
      { kind, label: "", durationSeconds: 5, backgroundColor: "0x05070a", clipPath: "C:\out\draft-1\clip0.mp4" },
      { kind: "explanation", label: "", durationSeconds: 5, backgroundColor: "0x05070a" },
    ],
  });
  const filterOf = (p: RenderPlan) => buildFfmpegArgs(p)[buildFfmpegArgs(p).indexOf("-filter_complex") + 1]!;

  it("pushes in and dims stock-clip hook scenes", () => {
    const filter = filterOf(clipPlan("hook"));
    expect(filter).toContain("scale=w='trunc(1080*(1+0.1*min(t/2.5,1))/2)*2':h=-2:eval=frame,crop=1080:1920,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.35:t=fill[sv0]");
  });

  it("leaves non-hook clip scenes and flat-card hook scenes untouched", () => {
    expect(filterOf(clipPlan("explanation"))).not.toContain("eval=frame");
    expect(filterOf(plan)).not.toContain("eval=frame");
  });
});

describe("computeSceneTransitions", () => {
  it("returns no transitions for a single scene, cumulative duration equals that scene's own duration", () => {
    const result = computeSceneTransitions([8]);
    expect(result.transitions).toEqual([]);
    expect(result.cumulativeDurationSeconds).toBe(8);
  });

  it("caps transition duration at MAX_TRANSITION_SECONDS (0.4) for long scenes", () => {
    const result = computeSceneTransitions([10, 10]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]!.durationSeconds).toBe(0.4);
    expect(result.transitions[0]!.offsetSeconds).toBe(9.6);
    // total = 10 + 10 - 0.4 (the overlap)
    expect(result.cumulativeDurationSeconds).toBe(19.6);
  });

  it("shrinks transition duration for a short scene instead of ever producing a negative offset", () => {
    // shorter scene is 1s -> 30% of it (0.3) is well under the 0.4 cap
    const result = computeSceneTransitions([1, 5]);
    expect(result.transitions[0]!.durationSeconds).toBeCloseTo(0.3, 5);
    expect(result.transitions[0]!.offsetSeconds).toBeCloseTo(0.7, 5);
    expect(result.transitions[0]!.offsetSeconds).toBeGreaterThanOrEqual(0);
  });

  it("never produces a negative offset even for a run of very short scenes back to back", () => {
    const durations = [0.5, 0.4, 0.3, 0.6, 0.2];
    const result = computeSceneTransitions(durations);
    for (const t of result.transitions) {
      expect(t.offsetSeconds).toBeGreaterThanOrEqual(0);
      expect(t.durationSeconds).toBeGreaterThan(0);
    }
  });

  it("chains offsets correctly across 3+ scenes -- each offset accounts for the previous transition's overlap", () => {
    const result = computeSceneTransitions([10, 10, 10]);
    expect(result.transitions).toHaveLength(2);
    // Transition 1: cumulative starts at 10, duration 0.4 -> offset 9.6, cumulative becomes 10+10-0.4=19.6
    expect(result.transitions[0]).toEqual({ durationSeconds: 0.4, offsetSeconds: 9.6 });
    // Transition 2: cumulative is now 19.6, duration 0.4 -> offset 19.2
    expect(result.transitions[1]!.durationSeconds).toBe(0.4);
    expect(result.transitions[1]!.offsetSeconds).toBeCloseTo(19.2, 9);
    expect(result.cumulativeDurationSeconds).toBeCloseTo(29.2, 9);
  });
});

describe("computeSyncedSceneTimeline", () => {
  it("starts each transition at the planned cut time and pads each input by its outgoing transition", () => {
    const { inputDurations, transitions } = computeSyncedSceneTimeline([2, 3, 2.5]);
    expect(transitions.map((t) => t.offsetSeconds)).toEqual([2, 5]);
    expect(inputDurations).toEqual([2.4, 3.4, 2.5]);
  });

  it("final video length equals the planned total: each xfade consumes exactly the padding it was given", () => {
    const durations = [1.5, 2.5, 1, 3, 2];
    const { inputDurations, transitions } = computeSyncedSceneTimeline(durations);
    // Merged length after step i = previous merged + inputDurations[i] - transition i-1.
    let merged = inputDurations[0]!;
    transitions.forEach((t, i) => {
      // The fade must fit inside the already-merged stream and start on the planned cut.
      expect(t.offsetSeconds + t.durationSeconds).toBeCloseTo(merged, 9);
      merged = merged + inputDurations[i + 1]! - t.durationSeconds;
    });
    expect(merged).toBeCloseTo(durations.reduce((a, b) => a + b, 0), 9);
  });

  it("returns the single scene unchanged", () => {
    expect(computeSyncedSceneTimeline([8])).toEqual({ inputDurations: [8], transitions: [] });
  });
});

/**
 * The three assertions below encode why the original tests failed on a
 * Linux/macOS reviewer machine: node:path's platform default treated the
 * Windows plan paths as a single filename there, leaking "C:\out\..."
 * into the filter graph and running ffmpeg in ".". The render helpers
 * must give identical results on every host for either path style.
 */
describe("host-OS independence of path handling", () => {
  const posixPlan: RenderPlan = {
    ...plan,
    voiceoverPath: "/tmp/out/draft-1/voiceover.mp3",
    assPath: "/tmp/out/draft-1/captions.ass",
    outputPath: "/tmp/out/draft-1/final.mp4",
  };

  it("strips Windows directories from every file reference no matter the host", () => {
    expect(renderBasename("C:\\out\\draft-1\\voiceover.mp3")).toBe("voiceover.mp3");
    expect(renderDirname("C:\\out\\draft-1\\final.mp4")).toBe("C:\\out\\draft-1");
    const filter = buildFfmpegArgs(plan)[buildFfmpegArgs(plan).indexOf("-filter_complex") + 1]!;
    expect(filter).not.toMatch(/[A-Za-z]:\\/);
    expect(filter).not.toContain("\\");
  });

  it("handles POSIX paths the same way", async () => {
    expect(renderBasename("/tmp/out/draft-1/voiceover.mp3")).toBe("voiceover.mp3");
    expect(renderDirname("/tmp/out/draft-1/final.mp4")).toBe("/tmp/out/draft-1");

    const args = buildFfmpegArgs(posixPlan);
    expect(args.join(" ")).not.toContain("/tmp/out");
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("subtitles=captions.ass:fontsdir=.[v]");

    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await renderVideo(posixPlan, { run });
    expect(run.mock.calls[0]![2]?.cwd).toBe("/tmp/out/draft-1");
  });
});

describe("renderVideo", () => {
  it("runs ffmpeg with cwd set to the output directory", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    await renderVideo(plan, runner);

    expect(run).toHaveBeenCalledTimes(1);
    const [command, , options] = run.mock.calls[0]!;
    expect(command).toBe("ffmpeg");
    expect(options?.cwd).toBe("C:\\out\\draft-1");
  });

  it("throws VideoFactoryError with ffmpeg's stderr on a non-zero exit", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "unknown filter", exitCode: 1 });
    const runner: ProcessRunner = { run };

    await expect(renderVideo(plan, runner)).rejects.toThrow(VideoFactoryError);
    await expect(renderVideo(plan, runner)).rejects.toThrow(/unknown filter/);
  });
});

describe("extractThumbnail", () => {
  // Unlike buildFfmpegArgs (pure), extractThumbnail now really writes the
  // brand .ass file to `cwd` before its second ffmpeg call, so these tests
  // need a real writable directory -- a fake "C:\out\draft-1" (fine when
  // only path *strings* were asserted) would throw ENOENT here.
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "thumbnail-test-"));
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("runs two ffmpeg calls: a plain frame extraction, then a subtitles-filter branding pass (not drawtext, which segfaults on the real render build)", async () =>
    withTempDir(async (dir) => {
      const thumbnailPath = join(dir, "thumbnail.jpg");
      const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      const runner: ProcessRunner = { run };

      await extractThumbnail(join(dir, "final.mp4"), 1.5, thumbnailPath, runner);

      expect(run).toHaveBeenCalledTimes(2);

      const [firstCommand, firstArgs] = run.mock.calls[0]!;
      expect(firstCommand).toBe("ffmpeg");
      expect(firstArgs).toContain(join(dir, "final.mp4"));
      expect(firstArgs).not.toContain("-vf");

      const [secondCommand, secondArgs, secondOptions] = run.mock.calls[1]!;
      expect(secondCommand).toBe("ffmpeg");
      expect(secondOptions?.cwd).toBe(dir);
      // References files by plain basename only inside the second call's own
      // args/filter -- same path-safety reasoning as buildFfmpegArgs.
      expect(secondArgs.join(" ")).not.toContain(dir);
      expect(secondArgs).toContain("raw-thumbnail.jpg");
      expect(secondArgs).toContain("thumbnail.jpg");
      const vfIndex = secondArgs.indexOf("-vf");
      expect(vfIndex).toBeGreaterThan(-1);
      expect(secondArgs[vfIndex + 1]).not.toContain("drawtext");
      expect(secondArgs[vfIndex + 1]).toContain("subtitles=thumbnail-brand.ass");

      // The real .ass file was written to cwd, and it's the thing that
      // actually carries "fillbookhq.com" (not the -vf arg itself).
      const assContent = readFileSync(join(dir, "thumbnail-brand.ass"), "utf-8");
      expect(assContent).toContain("fillbookhq.com");
    }));

  it("throws VideoFactoryError if the raw frame extraction fails, without attempting the branding pass", async () =>
    withTempDir(async (dir) => {
      const thumbnailPath = join(dir, "thumbnail.jpg");
      const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "no such stream", exitCode: 1 });
      const runner: ProcessRunner = { run };

      await expect(extractThumbnail(join(dir, "final.mp4"), 1.5, thumbnailPath, runner)).rejects.toThrow(/no such stream/);
      expect(run).toHaveBeenCalledTimes(1);
    }));

  it("throws VideoFactoryError if the branding pass fails", async () =>
    withTempDir(async (dir) => {
      const thumbnailPath = join(dir, "thumbnail.jpg");
      const run = vi
        .fn()
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
        .mockResolvedValueOnce({ stdout: "", stderr: "unknown filter subtitles", exitCode: 1 });
      const runner: ProcessRunner = { run };

      await expect(extractThumbnail(join(dir, "final.mp4"), 1.5, thumbnailPath, runner)).rejects.toThrow(/unknown filter subtitles/);
    }));
});
