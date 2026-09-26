import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFfmpegArgs,
  renderBasename,
  renderDirname,
  renderVideo,
  renderThumbnailCard,
  computeSceneTransitions,
  computeSyncedSceneTimeline,
  computeCardLayout,
  assertCardClearsOverlays,
} from "../../scripts/video-factory/render";
import { PILOTS } from "../../src/shortform/pilots";
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
    expect(filter).toContain("[xf0]subtitles=captions.ass:fontsdir=fonts[v]");
  });

  it("concatenates voiceover + silence pad, ducks the music under the voice, mixes, then loudness-normalises", () => {
    const args = buildFfmpegArgs(plan);
    const filterIndex = args.indexOf("-filter_complex");
    const filter = args[filterIndex + 1]!;
    // scenes.length = 2 -> voiceover is input 2, silence is input 3, music is input 4
    expect(filter).toContain("[2:a][3:a]concat=n=2:v=0:a=1[voicefull]");
    expect(args).toContain("anullsrc=r=24000:cl=mono:d=2.500");
    expect(filter).toContain("[voicefull]asplit=2[voice][voicesc]");
    expect(filter).toContain("[4:a]afade=t=in:st=0:d=0.5,volume=0.2[musicvol]");
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

  it("pans a 1080x1170 window down the screenshot between dark label/caption bands and normalises to yuv420p", () => {
    const args = buildFfmpegArgs(imagePlan);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("[1:v]scale=1080:-2,pad=1080:'max(ih,1170)':0:'(oh-ih)/2':color=0x060a0d,");
    expect(filter).toContain("crop=1080:1170:0:'(in_h-1170)*min(t/5.000,1)',pad=1080:1920:0:230:color=0x060a0d,");
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

describe("buildFfmpegArgs with a verified recording (clipTimeRangeSeconds/sourceCrop/privacyMasks)", () => {
  const recordingPlan: RenderPlan = {
    ...plan,
    scenes: [
      {
        kind: "product",
        label: "",
        durationSeconds: 3,
        backgroundColor: "0x05070a",
        clipPath: "C:\\out\\draft-1\\recording.webm",
        clipTimeRangeSeconds: { start: 3, end: 6.5 },
        sourceCrop: { x: 240, y: 390, w: 800, h: 140 },
        privacyMasks: [{ x: 0, y: 1370, w: 240, h: 30 }],
      },
      { kind: "explanation", label: "", durationSeconds: 5, backgroundColor: "0x05070a" },
    ],
  };

  it("trims the clip to its declared range and plays it once -- never -stream_loop", () => {
    const args = buildFfmpegArgs(recordingPlan);
    const joined = args.join(" ");
    expect(joined).toContain("-ss 3.000 -to 6.400 -i recording.webm"); // 3.4s = scene's 3s + 0.4s transition padding
    expect(joined).not.toContain("-stream_loop -1 -t 3");
  });

  it("throws instead of looping when the declared range is shorter than the scene (plus transition padding) needs", () => {
    const tooShort: RenderPlan = {
      ...recordingPlan,
      scenes: [{ ...recordingPlan.scenes[0]!, clipTimeRangeSeconds: { start: 3, end: 5.9 } }, recordingPlan.scenes[1]!],
    };
    expect(() => buildFfmpegArgs(tooShort)).toThrow(/Refusing to loop a real recording/);
  });

  it("crops to the source rectangle and fits (never zoom-crops) it into the evidence band above the platforms' right-hand action column", () => {
    const filter = buildFfmpegArgs(recordingPlan)[buildFfmpegArgs(recordingPlan).indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("[0:v]crop=800:140:240:390,scale=1080:600:force_original_aspect_ratio=decrease:force_divisible_by=2,format=gbrp,geq=");
    expect(filter).toContain(
      ",format=yuv420p,pad=1080:1920:'(ow-iw)/2':'260+(600-ih)/2':color=0x060a0d,fps=30,setsar=1:1,setpts=PTS-STARTPTS[sv0]",
    );
  });

  it("feathers a verified crop's outer edges into the page background instead of leaving a hard rectangle", () => {
    const filter = buildFfmpegArgs(recordingPlan)[buildFfmpegArgs(recordingPlan).indexOf("-filter_complex") + 1]!;
    expect(filter).toContain("r='6+(r(X,Y)-6)*min(1,min(min(X,W-1-X),min(Y,H-1-Y))/28)'");
  });

  it("a mask entirely outside the source crop is not drawn (nothing left to hide once cropped out)", () => {
    const filter = buildFfmpegArgs(recordingPlan)[buildFfmpegArgs(recordingPlan).indexOf("-filter_complex") + 1]!;
    expect(filter).not.toContain("drawbox");
  });

  it("a mask overlapping the source crop IS drawn, translated into the crop's own coordinates", () => {
    const withOverlappingMask: RenderPlan = {
      ...recordingPlan,
      scenes: [{ ...recordingPlan.scenes[0]!, privacyMasks: [{ x: 260, y: 400, w: 50, h: 20 }] }, recordingPlan.scenes[1]!],
    };
    const filter = buildFfmpegArgs(withOverlappingMask)[buildFfmpegArgs(withOverlappingMask).indexOf("-filter_complex") + 1]!;
    // mask x:260,y:400 minus crop origin x:240,y:390 -> drawn at 20,10 in the cropped frame's own coordinates.
    expect(filter).toContain("drawbox=x=20:y=10:w=50:h=20:color=black:t=fill");
  });

  it("an ordinary stock clip (no clipTimeRangeSeconds) keeps the existing loop/fill-canvas behavior unchanged", () => {
    const stockPlan: RenderPlan = { ...plan, scenes: [{ kind: "explanation", label: "", durationSeconds: 5, backgroundColor: "0x05070a", clipPath: "C:\\a\\stock.mp4" }, plan.scenes[1]!] };
    const args = buildFfmpegArgs(stockPlan);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.join(" ")).toContain("-stream_loop -1 -t 5.400 -i stock.mp4");
    expect(filter).toContain("[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1:1,setpts=PTS-STARTPTS[sv0]");
  });
});

describe("buildFfmpegArgs music selection", () => {
  it("seeks into the chosen track and references it by basename", () => {
    const args = buildFfmpegArgs({ ...plan, musicFile: "C:\\assets\\music\\other-track.mp3", musicStartSeconds: 42.5 });
    const joined = args.join(" ");
    expect(joined).toContain("-stream_loop -1 -ss 42.5 -t 10.000 -i other-track.mp3");
    expect(joined).not.toContain("assets");
    expect(joined).not.toContain("ambient-technology.mp3");
  });

  it("omits -ss when the segment starts at 0 and keeps the default bed when no track is named", () => {
    expect(buildFfmpegArgs({ ...plan, musicFile: "/m/a.mp3", musicStartSeconds: 0 }).join(" ")).toContain("-stream_loop -1 -t 10.000 -i a.mp3");
    expect(buildFfmpegArgs(plan).join(" ")).toContain("-i ambient-technology.mp3");
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
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("subtitles=captions.ass:fontsdir=fonts[v]");

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

describe("renderThumbnailCard", () => {
  // Unlike buildFfmpegArgs (pure), renderThumbnailCard really writes the
  // .ass file to `cwd` before its ffmpeg call, so these tests need a real
  // writable directory -- a fake "C:\out\draft-1" (fine when only path
  // *strings* were asserted) would throw ENOENT here.
  async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "thumbnail-test-"));
    try {
      return await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("runs one ffmpeg call compositing a flat color source with a subtitles-filter text overlay (not drawtext, which segfaults on the real render build), reading no video frame at all", async () =>
    withTempDir(async (dir) => {
      const thumbnailPath = join(dir, "thumbnail.jpg");
      const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
      const runner: ProcessRunner = { run };

      await renderThumbnailCard("You already know which trade you're about to repeat", "Trading discipline", thumbnailPath, runner);

      expect(run).toHaveBeenCalledTimes(1);

      const [command, args, options] = run.mock.calls[0]!;
      expect(command).toBe("ffmpeg");
      expect(options?.cwd).toBe(dir);
      expect(args).toContain("lavfi");
      const inputIndex = args.indexOf("-i");
      expect(args[inputIndex + 1]).toContain("color=c=0x05070a");
      // References the .ass file by plain basename only -- same path-safety
      // reasoning as buildFfmpegArgs.
      expect(args.join(" ")).not.toContain(dir);
      expect(args).toContain("thumbnail.jpg");
      const vfIndex = args.indexOf("-vf");
      expect(vfIndex).toBeGreaterThan(-1);
      expect(args[vfIndex + 1]).not.toContain("drawtext");
      expect(args[vfIndex + 1]).toContain("subtitles=thumbnail-card.ass");

      // The real .ass file was written to cwd, carrying the site badge, the
      // topic label, and the video's own hook line.
      const assContent = readFileSync(join(dir, "thumbnail-card.ass"), "utf-8");
      expect(assContent).toContain("fillbookhq.com");
      expect(assContent).toContain("TRADING DISCIPLINE");
      expect(assContent).toContain("You already know which trade you're about to repeat");
    }));

  it("throws VideoFactoryError with ffmpeg's stderr on a non-zero exit", async () =>
    withTempDir(async (dir) => {
      const thumbnailPath = join(dir, "thumbnail.jpg");
      const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "unknown filter subtitles", exitCode: 1 });
      const runner: ProcessRunner = { run };

      await expect(renderThumbnailCard("Hook", "Topic", thumbnailPath, runner)).rejects.toThrow(VideoFactoryError);
      await expect(renderThumbnailCard("Hook", "Topic", thumbnailPath, runner)).rejects.toThrow(/unknown filter subtitles/);
    }));
});

describe("computeCardLayout", () => {
  it("a tall card is capped at 760px wide so it never reaches the platforms' right-hand action column", () => {
    const layout = computeCardLayout(1004, 868);
    expect(layout.width).toBeLessThanOrEqual(760);
    expect(layout.x + layout.width).toBeLessThanOrEqual(920);
    expect(layout.y).toBeGreaterThanOrEqual(280);
    expect(layout.textTop).toBe(layout.y + layout.height + 64);
  });

  it("a short card runs up to 1000px wide when it still ends above the action column", () => {
    const layout = computeCardLayout(1004, 326);
    expect(layout.width).toBe(1000);
    expect(layout.x).toBe(40);
    expect(layout.y + layout.height).toBeLessThanOrEqual(700);
    expect(layout.y).toBeGreaterThanOrEqual(280);
  });

  it("the P8 day-of-week card (566px tall) stays narrow, clear of TikTok's buttons on a 20:9 phone (owner screenshot 2026-09-25)", () => {
    const layout = computeCardLayout(1004, 566);
    expect(layout.x + layout.width).toBeLessThanOrEqual(920);
  });

  it("a card too tall for the wide slot falls back to the narrow layout", () => {
    const layout = computeCardLayout(1004, 776);
    expect(layout.width).toBeLessThanOrEqual(760);
  });

  it("dimensions are always even (yuv420p needs even sizes)", () => {
    for (const [w, h] of [[1003, 327], [999, 861], [37, 11]] as const) {
      const layout = computeCardLayout(w, h);
      expect(layout.width % 2).toBe(0);
      expect(layout.height % 2).toBe(0);
    }
  });
});

describe("buildFfmpegArgs card presentation", () => {
  const cardPlan: RenderPlan = {
    ...plan,
    scenes: [
      {
        kind: "product",
        label: "",
        durationSeconds: 3,
        backgroundColor: "0x05070a",
        clipPath: "C:\\out\\draft-1\\recording.mp4",
        clipTimeRangeSeconds: { start: 1, end: 4.5 },
        sourceCrop: { x: 38, y: 300, w: 1004, h: 326 },
        card: {
          backgroundPath: "C:\\out\\draft-1\\card-background.png",
          evidence: { x: 42, y: 400, width: 996, height: 324, maskPath: "C:\\out\\draft-1\\card-mask-0.png", shadowPath: "C:\\out\\draft-1\\card-shadow-0.png" },
        },
      },
      { kind: "cta", label: "", durationSeconds: 5, backgroundColor: "0x05070a", card: { backgroundPath: "C:\\out\\draft-1\\card-background.png" } },
    ],
  };

  it("composites the rounded, shadowed evidence card onto the designed background", () => {
    const args = buildFfmpegArgs(cardPlan);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.join(" ")).toContain("card-mask-0.png");
    expect(args.join(" ")).toContain("card-shadow-0.png");
    expect(filter).toContain("[0:v]crop=1004:326:38:300,");
    expect(filter).toContain("scale=996:324,format=rgba[cr0]");
    expect(filter).toContain("[cr0][mk0]alphamerge[cd0]");
    expect(filter).toContain("[bg0][sh0]overlay=2:382[cb0]");
    expect(filter).toContain("[cb0][cd0]overlay=42:400:shortest=1");
  });

  it("a text-only card scene loops the background still instead of a solid color", () => {
    const args = buildFfmpegArgs(cardPlan);
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.join(" ")).toMatch(/-loop 1 -framerate 30 -t [\d.]+ -i card-background\.png/);
    expect(filter).toContain("[1:v]scale=1080:1920,fps=30,format=yuv420p,setsar=1:1,setpts=PTS-STARTPTS[sv1]");
  });
});

describe("platform overlay zones (owner rule 2026-09-25: nothing under TikTok/Shorts buttons or captions)", () => {
  it("every evidence card in every verified concept clears the right-hand buttons and the caption area", () => {
    for (const plan of PILOTS) {
      for (const scene of plan.scenes) {
        if (!scene.crop) continue;
        expect(() => assertCardClearsOverlays(computeCardLayout(scene.crop!.w, scene.crop!.h)), `${plan.planId} ${scene.sceneId}`).not.toThrow();
      }
    }
  });

  it("rejects a card that would run under the button column", () => {
    expect(() => assertCardClearsOverlays({ x: 40, y: 300, width: 1000, height: 600, radius: 40, textTop: 964 })).toThrow(/right-hand buttons/);
  });

  it("rejects a card whose text would reach the caption area", () => {
    expect(() => assertCardClearsOverlays({ x: 160, y: 500, width: 760, height: 900, radius: 30, textTop: 1464 })).toThrow(/caption area/);
  });
});
