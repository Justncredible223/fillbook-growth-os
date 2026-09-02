import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRunner } from "./processRunner.js";
import { VideoFactoryError } from "./types.js";
import { parseSrt, type SrtCue } from "./captions.js";

/**
 * Same voice used for the Day 1 FillbookHQ TikTok video
 * (~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md) -- a free
 * neural voice via edge-tts, no API key, no cloned/real-person voice
 * identity per that doc's guardrail. Kept as the default so output is
 * consistent across renders; override only if you deliberately want
 * voice variety (see `edge-tts --list-voices` for other free options).
 */
export const DEFAULT_VOICE = "en-US-AndrewNeural";

export interface VoiceoverResult {
  mp3Path: string;
  srtCues: SrtCue[];
  durationSeconds: number;
}

/**
 * Runs edge-tts against the approved script text, via `--file` (not
 * `--text`) so arbitrary punctuation/quotes in the script never need
 * shell-escaping. Uses --write-subtitles for real per-sentence timing
 * (see captions.ts) rather than guessing caption timing from duration.
 */
export async function generateVoiceover(
  scriptText: string,
  outDir: string,
  runner: ProcessRunner,
  voice: string = DEFAULT_VOICE,
): Promise<VoiceoverResult> {
  const scriptPath = join(outDir, "script.txt");
  const mp3Path = join(outDir, "voiceover.mp3");
  const srtPath = join(outDir, "voiceover.srt");
  writeFileSync(scriptPath, scriptText, "utf-8");

  const result = await runner.run("uvx", [
    "--from",
    "edge-tts",
    "edge-tts",
    "--voice",
    voice,
    "--file",
    scriptPath,
    "--write-media",
    mp3Path,
    "--write-subtitles",
    srtPath,
  ]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`edge-tts failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  let srtContent: string;
  try {
    srtContent = readFileSync(srtPath, "utf-8");
  } catch (err) {
    throw new VideoFactoryError(`edge-tts reported success but did not write subtitles to "${srtPath}": ${(err as Error).message}`);
  }
  const srtCues = parseSrt(srtContent);
  if (srtCues.length === 0) {
    throw new VideoFactoryError("edge-tts produced an empty subtitle file -- cannot time captions without it.");
  }

  const durationSeconds = await measureAudioDuration(mp3Path, runner);
  return { mp3Path, srtCues, durationSeconds };
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
