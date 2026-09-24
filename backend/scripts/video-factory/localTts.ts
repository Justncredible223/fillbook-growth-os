/**
 * Fully offline narration synthesis, for local test renders where a
 * network TTS call (edge-tts, the real production voice) is disallowed.
 * Uses Windows's built-in SAPI 5 (System.Speech), via a small bundled
 * PowerShell script (localTts.ps1) -- never reaches the network, no API
 * key, no paid service. This is explicitly NOT the production voice: it
 * exists only so a local verification render can have real, measurable
 * narration timing instead of a silent placeholder, never presented as a
 * finished, publish-ready voiceover. Every caller must report audio
 * provenance (offline SAPI vs. real edge-tts vs. supplied audio) rather
 * than imply a finished narration track.
 *
 * Windows-only (System.Speech). A non-Windows CI runner (the real
 * production GitHub Actions worker, ubuntu-latest) has no equivalent
 * built in and would need `pip install edge-tts` (a network call) or a
 * supplied audio file -- see this module's isAvailable().
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import { VideoFactoryError } from "./types.js";
import { runFfprobeJson } from "./validate.js";

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), "localTts.ps1");

export interface LocalNarrationResult {
  path: string;
  durationSeconds: number;
}

/** True only on a host that can plausibly run this (Windows + the bundled script present) -- never assumed. */
export function isAvailable(): boolean {
  return process.platform === "win32" && existsSync(SCRIPT_PATH);
}

/**
 * Synthesizes `text` to a WAV file at `outPath` via offline SAPI, then
 * measures its REAL duration with ffprobe -- never estimated from word/
 * character count. Throws (does not fall back silently) if the platform
 * can't run this or PowerShell/ffprobe fails, so a caller never mistakes a
 * failed synthesis for a real, measured narration.
 */
export async function synthesizeOfflineNarration(text: string, outPath: string, runner: ProcessRunner, voiceName?: string): Promise<LocalNarrationResult> {
  if (!isAvailable()) {
    throw new VideoFactoryError("Offline local TTS (SAPI) is only available on Windows -- no supplied audio and no network TTS were provided either.");
  }
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT_PATH, "-Text", text, "-OutPath", outPath];
  if (voiceName) args.push("-VoiceName", voiceName);
  const result = await runner.run("powershell", args, {});
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`Offline narration synthesis failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  const probe = await runFfprobeJson(outPath, runner);
  const durationSeconds = Number(probe.format?.duration ?? 0);
  if (!(durationSeconds > 0)) {
    throw new VideoFactoryError(`Offline narration synthesis produced a file with no measurable duration: ${outPath}`);
  }
  return { path: outPath, durationSeconds };
}
