import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateVoiceover, measureAudioDuration, DEFAULT_VOICE, respellFillbookForTts } from "../../scripts/video-factory/voiceover";
import { VideoFactoryError } from "../../scripts/video-factory/types";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const SAMPLE_WORDS = JSON.stringify([
  { text: "Hello", startSeconds: 0.05, endSeconds: 0.4 },
  { text: "there.", startSeconds: 0.45, endSeconds: 0.9 },
]);

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
  it("writes the script to a file and invokes the word-timing script via python3", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "python3") {
        writeFileSync(args[args.indexOf("--out-words") + 1]!, SAMPLE_WORDS);
        writeFileSync(args[args.indexOf("--out-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "ffprobe") {
        return { stdout: JSON.stringify({ format: { duration: "3.5" } }), stderr: "", exitCode: 0 };
      }
      throw new Error(`unexpected command ${command}`);
    });
    const runner: ProcessRunner = { run };

    const result = await generateVoiceover("Hello there.", dir, runner);

    expect(run.mock.calls[0]![0]).toBe("python3");
    const args = run.mock.calls[0]![1] as string[];
    expect(args).toContain("--file");
    expect(args[args.indexOf("--voice") + 1]).toBe(DEFAULT_VOICE);
    expect(readFileSync(join(dir, "script.txt"), "utf-8")).toBe("Hello there.");
    expect(result.durationSeconds).toBe(3.5);
    expect(result.wordCues).toHaveLength(2);
    expect(result.wordCues[0]).toEqual({ text: "Hello", startSeconds: 0.05, endSeconds: 0.4 });
  });

  it("respells Fillbook to Fill book in the text sent to TTS (pronunciation fix)", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "python3") {
        writeFileSync(args[args.indexOf("--out-words") + 1]!, SAMPLE_WORDS);
        writeFileSync(args[args.indexOf("--out-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: JSON.stringify({ format: { duration: "3.5" } }), stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await generateVoiceover("Fillbook tracks your drawdown.", dir, runner);

    expect(readFileSync(join(dir, "script.txt"), "utf-8")).toBe("Fill book tracks your drawdown.");
  });

  it("respects a custom voice override", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "python3") {
        writeFileSync(args[args.indexOf("--out-words") + 1]!, SAMPLE_WORDS);
        writeFileSync(args[args.indexOf("--out-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: JSON.stringify({ format: { duration: "3.5" } }), stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await generateVoiceover("Hello there.", dir, runner, "en-US-JennyNeural");

    const args = run.mock.calls[0]![1] as string[];
    expect(args[args.indexOf("--voice") + 1]).toBe("en-US-JennyNeural");
  });

  it("throws VideoFactoryError when the word-timing script exits non-zero", async () => {
    const dir = tempDir();
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "voice not found", exitCode: 1 });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(VideoFactoryError);
    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(/voice not found/);
  });

  it("throws VideoFactoryError if the word-timing script reports success but never wrote the words file", async () => {
    const dir = tempDir();
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(VideoFactoryError);
  });

  it("throws VideoFactoryError on an empty word-timing array", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "python3") {
        writeFileSync(args[args.indexOf("--out-words") + 1]!, "[]");
        writeFileSync(args[args.indexOf("--out-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(/no word timing data/);
  });

  it("throws VideoFactoryError on invalid JSON in the words file", async () => {
    const dir = tempDir();
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command === "python3") {
        writeFileSync(args[args.indexOf("--out-words") + 1]!, "not json");
        writeFileSync(args[args.indexOf("--out-media") + 1]!, "");
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const runner: ProcessRunner = { run };

    await expect(generateVoiceover("Hello.", dir, runner)).rejects.toThrow(/invalid JSON/);
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

describe("respellFillbookForTts", () => {
  it("splits Fillbook into Fill book, preserving title case", () => {
    expect(respellFillbookForTts("Fillbook tracks trades.")).toBe("Fill book tracks trades.");
  });

  it("preserves all-caps", () => {
    expect(respellFillbookForTts("FILLBOOK IS FREE.")).toBe("FILL BOOK IS FREE.");
  });

  it("preserves lowercase", () => {
    expect(respellFillbookForTts("check out fillbook today.")).toBe("check out fill book today.");
  });

  it("handles multiple mentions in the same text", () => {
    expect(respellFillbookForTts("Fillbook helps. Try Fillbook now.")).toBe("Fill book helps. Try Fill book now.");
  });

  it("does not affect text with no mention of Fillbook", () => {
    expect(respellFillbookForTts("Most traders lose money.")).toBe("Most traders lose money.");
  });

  it("does not match Fillbook as a substring of another word", () => {
    expect(respellFillbookForTts("Fillbookish is not a real word.")).toBe("Fillbookish is not a real word.");
  });
});
