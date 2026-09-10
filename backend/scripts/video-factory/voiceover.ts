import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import { VideoFactoryError } from "./types.js";
import type { WordCue } from "./types.js";

/**
 * Upgraded from the original "en-US-AndrewNeural" (Day 1 FillbookHQ TikTok
 * video, ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md) to the
 * "Multilingual" HD neural tier -- same free edge-tts, no API key, no
 * cloned/real-person voice identity per that doc's guardrail, but a
 * noticeably more natural/expressive cadence than the standard neural
 * voices. Kept as the default so output is consistent across renders;
 * override only if you deliberately want voice variety (see
 * `edge-tts --list-voices` for other free options).
 */
export const DEFAULT_VOICE = "en-US-AndrewMultilingualNeural";

export interface VoiceoverResult {
  mp3Path: string;
  wordCues: WordCue[];
  durationSeconds: number;
}

const WORD_TIMING_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "edge_tts_words.py");

/**
 * Runs edge_tts_words.py against the approved script text, via a script
 * file (not inline text) so arbitrary punctuation/quotes never need
 * shell-escaping -- same reasoning as the old CLI-based `--file` flag.
 * Calls the edge_tts Python library directly (through this helper script)
 * rather than the edge-tts CLI, because only the library's WordBoundary
 * stream gives real per-word timing -- the CLI's --write-subtitles only
 * ever produced sentence-level SRT cues, not enough to drive word-by-word
 * highlighted captions (see captions.ts's buildWordHighlightCues).
 */
export async function generateVoiceover(
  scriptText: string,
  outDir: string,
  runner: ProcessRunner,
  voice: string = DEFAULT_VOICE,
): Promise<VoiceoverResult> {
  const scriptPath = join(outDir, "script.txt");
  const mp3Path = join(outDir, "voiceover.mp3");
  const wordsPath = join(outDir, "voiceover.words.json");
  writeFileSync(scriptPath, scriptText, "utf-8");

  const result = await runner.run("python3", [
    WORD_TIMING_SCRIPT,
    "--voice",
    voice,
    "--file",
    scriptPath,
    "--out-media",
    mp3Path,
    "--out-words",
    wordsPath,
  ]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`edge-tts word-timing script failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  let wordsContent: string;
  try {
    wordsContent = readFileSync(wordsPath, "utf-8");
  } catch (err) {
    throw new VideoFactoryError(
      `edge-tts word-timing script reported success but did not write word timings to "${wordsPath}": ${(err as Error).message}`,
    );
  }

  let wordCues: WordCue[];
  try {
    wordCues = JSON.parse(wordsContent) as WordCue[];
  } catch (err) {
    throw new VideoFactoryError(`edge-tts word-timing script wrote invalid JSON to "${wordsPath}": ${(err as Error).message}`);
  }
  if (wordCues.length === 0) {
    throw new VideoFactoryError("edge-tts produced no word timing data -- cannot time captions without it.");
  }

  const durationSeconds = await measureAudioDuration(mp3Path, runner);
  return { mp3Path, wordCues, durationSeconds };
}

/** ffprobe -show_format gives duration directly -- no need to decode the audio. */
export async function measureAudioDuration(mp3Path: string, runner: ProcessRunner): Promise<number> {
  const result = await runner.run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", mp3Path]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffprobe failed to read "${mp3Path}" (exit ${result.exitCode}): ${result.stderr}`);
  }
  let parsed: { format?: { duration?: string } };
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new VideoFactoryError(`ffprobe returned non-JSON output for "${mp3Path}": ${(err as Error).message}`);
  }
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoFactoryError(`ffprobe returned an invalid duration for "${mp3Path}": ${parsed.format?.duration}`);
  }
  return duration;
}
