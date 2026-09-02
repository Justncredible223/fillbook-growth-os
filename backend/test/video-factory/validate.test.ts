import { describe, it, expect, vi } from "vitest";
import { runFfprobeJson, validateOutput } from "../../scripts/video-factory/validate";
import { VideoFactoryError, type FfprobeResult } from "../../scripts/video-factory/types";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const goodFfprobe: FfprobeResult = {
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
    { codec_type: "audio", codec_name: "aac" },
  ],
  format: { duration: "12.4", size: "2048000" },
};

describe("validateOutput", () => {
  it("passes a well-formed 9:16 output matching expected duration", () => {
    const result = validateOutput(goodFfprobe, 2048000, 12.5);
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it("fails when there is no video stream", () => {
    const result = validateOutput({ streams: [goodFfprobe.streams[1]!], format: goodFfprobe.format }, 100, 12.5);
    expect(result.passed).toBe(false);
    expect(result.checks.find((c) => c.name === "video stream present")?.passed).toBe(false);
  });

  it("fails when there is no audio stream", () => {
    const result = validateOutput({ streams: [goodFfprobe.streams[0]!], format: goodFfprobe.format }, 100, 12.5);
    expect(result.checks.find((c) => c.name === "audio stream present")?.passed).toBe(false);
  });

  it("fails when resolution is not 1080x1920", () => {
    const wrongRes: FfprobeResult = {
      streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }, goodFfprobe.streams[1]!],
      format: goodFfprobe.format,
    };
    const result = validateOutput(wrongRes, 100, 12.5);
    expect(result.checks.find((c) => c.name.includes("resolution"))?.passed).toBe(false);
  });

  it("fails when duration is missing or zero", () => {
    const result = validateOutput({ streams: goodFfprobe.streams, format: { duration: "0" } }, 100, 12.5);
    expect(result.checks.find((c) => c.name.includes("sane positive"))?.passed).toBe(false);
  });

  it("fails when duration diverges too far from the expected narration+pad duration", () => {
    const result = validateOutput(goodFfprobe, 100, 2.0); // expected 2s, actual 12.4s
    expect(result.checks.find((c) => c.name.includes("within"))?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails when the file is empty", () => {
    const result = validateOutput(goodFfprobe, 0, 12.5);
    expect(result.checks.find((c) => c.name.includes("non-empty"))?.passed).toBe(false);
  });
});

describe("runFfprobeJson", () => {
  it("parses ffprobe's JSON stdout", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify(goodFfprobe), stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    const result = await runFfprobeJson("final.mp4", runner);

    expect(result).toEqual(goodFfprobe);
  });

  it("throws VideoFactoryError on a non-zero exit", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "No such file", exitCode: 1 });
    const runner: ProcessRunner = { run };

    await expect(runFfprobeJson("missing.mp4", runner)).rejects.toThrow(VideoFactoryError);
  });

  it("throws VideoFactoryError on malformed JSON", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "not json", stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    await expect(runFfprobeJson("final.mp4", runner)).rejects.toThrow(VideoFactoryError);
  });
});
