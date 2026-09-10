import { describe, it, expect, vi } from "vitest";
import { buildFfmpegArgs, renderBasename, renderDirname, renderVideo } from "../../scripts/video-factory/render";
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
    expect(args).toContain("color=c=0x05070a:s=1080x1920:d=5.000:r=30");
    expect(args).toContain("color=c=0x0d1420:s=1080x1920:d=5.000:r=30");
  });

  it("concatenates all scene video inputs before applying subtitles", () => {
    const args = buildFfmpegArgs(plan);
    const filterIndex = args.indexOf("-filter_complex");
    const filter = args[filterIndex + 1]!;
    expect(filter).toContain("[sv0][sv1]concat=n=2:v=1:a=0[bgraw]");
    expect(filter).toContain("[bgraw]subtitles=captions.ass:fontsdir=.[v]");
  });

  it("concatenates real voiceover audio with the silence pad", () => {
    const args = buildFfmpegArgs(plan);
    const filterIndex = args.indexOf("-filter_complex");
    const filter = args[filterIndex + 1]!;
    // scenes.length = 2 -> voiceover is input 2, silence is input 3
    expect(filter).toContain("[2:a][3:a]concat=n=2:v=0:a=1[a]");
    expect(args).toContain("anullsrc=r=24000:cl=mono:d=2.500");
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
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("[bgraw]subtitles=captions.ass:fontsdir=.[v]");

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
