import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVoiceover, measureAudioDuration, DEFAULT_VOICE } from "../../scripts/video-factory/voiceover";
import { VideoFactoryError } from "../../scripts/video-factory/types";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const SAMPLE_SRT = `1
00:00:00,050 --> 00:00:03,500
Hello there.
`;

let tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "video-factory-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("generateVoiceover", () => {
  it("writes the script to a file and invokes edge-tts with --file (never --text, to avoid shell-escaping issues)", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "uvx") {
        // Simulate edge-tts's real side effects: write mp3 + srt.
        writeFileSync(args[args.indexOf("--write-subtitles") + 1]!, SAMPLE_SRT);
        writeFileSync(args[args.indexOf("--write-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "ffprobe") {
        return { stdout: JSON.stringify({ format: { duration: "3.5" } }), stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected command ${command}`);
    });
    const runner: ProcessRunner = { run };

    const result = await generateVoiceover("Hello there.", dir, runner);

    expect(run.mock.calls[0]![0]).toBe("uvx");
    const args = run.mock.calls[0]![1] as string[];
    expect(args).toContain("--file");
    expect(args).not.toContain("--text");
    expect(args[args.indexOf("--voice") + 1]).toBe(DEFAULT_VOICE);
    expect(readFileSync(join(dir, "script.txt"), "utf-8")).toBe("Hello there.");
    expect(result.durationSeconds).toBe(3.5);
    expect(result.srtCues).toHaveLength(1);
  });

  it("respects a custom voice override", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "uvx") {
        writeFileSync(args[args.indexOf("--write-subtitles") + 1]!, SAMPLE_SRT);
        writeFileSync(args[args.indexOf("--write-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: JSON.stringify({ format: { duration: "3.5" } }), stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await generateVoiceover("Hello there.", dir, runner, "en-US-JennyNeural");

    const args = run.mock.calls[0]![1] as string[];
    expect(args[args.indexOf("--voice") + 1]).toBe("en-US-JennyNeural");
  });

  it("throws VideoFactoryError when edge-tts exits non-zero", async () => {
    const dir = tempDir();
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "voice not found", exitCode: 1 });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(VideoFactoryError);
    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(/voice not found/);
  });

  it("throws VideoFactoryError if edge-tts reports success but never wrote the subtitle file", async () => {
    const dir = tempDir();
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(VideoFactoryError);
  });

  it("throws VideoFactoryError on an empty subtitle file", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "uvx") {
        writeFileSync(args[args.indexOf("--write-subtitles") + 1]!, "");
        writeFileSync(args[args.indexOf("--write-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(/empty subtitle/);
  });
});

describe("measureAudioDuration", () => {
  it("parses duration from ffprobe's format.duration", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ format: { duration: "8.712" } }), stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    expect(await measureAudioDuration("voiceover.mp3", runner)).toBe(8.712);
  });

  it("throws VideoFactoryError when ffprobe fails", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "invalid file", exitCode: 1 });
    const runner: ProcessRunner = { run };

    await expect(measureAudioDuration("bad.mp3", runner)).rejects.toThrow(VideoFactoryError);
  });

  it("throws VideoFactoryError when duration is missing or non-numeric", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ format: {} }), stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    await expect(measureAudioDuration("voiceover.mp3", runner)).rejects.toThrow(VideoFactoryError);
  });
});
