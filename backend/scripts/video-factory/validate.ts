import type { ProcessRunner } from "./processRunner.js";
import type { FfprobeResult, ValidationCheck, ValidationResult } from "./types.js";
import { VideoFactoryError } from "./types.js";

const EXPECTED_WIDTH = 1080;
const EXPECTED_HEIGHT = 1920;
/** Generous tolerance -- ffmpeg's -shortest + concat rounding means exact-to-the-millisecond duration match isn't realistic or necessary. */
const DURATION_TOLERANCE_SECONDS = 5;

export async function runFfprobeJson(filePath: string, runner: ProcessRunner): Promise<FfprobeResult> {
  const result = await runner.run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffprobe failed to inspect "${filePath}" (exit ${result.exitCode}): ${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout) as FfprobeResult;
  } catch (err) {
    throw new VideoFactoryError(`ffprobe returned non-JSON output for "${filePath}": ${(err as Error).message}`);
  }
}

/**
 * Automatic validation gate the spec requires: exists (caller supplies
 * fileSizeBytes, which throws upstream via fs.statSync if the file is
 * genuinely missing), video+audio streams present, expected 9:16
 * resolution, sane non-zero duration, duration in the right ballpark
 * versus narration+pad, non-zero filesize. Never throws itself --
 * returns a structured result so index.ts can print every check (pass
 * or fail) before deciding whether to exit non-zero.
 */
export function validateOutput(
  ffprobe: FfprobeResult,
  fileSizeBytes: number,
  expectedDurationSeconds: number,
): ValidationResult {
  const checks: ValidationCheck[] = [];

  const videoStream = ffprobe.streams.find((s) => s.codec_type === "video");
  checks.push({
    name: "video stream present",
    passed: Boolean(videoStream),
    detail: videoStream ? `codec ${videoStream.codec_name}` : "no video stream found",
  });

  const audioStream = ffprobe.streams.find((s) => s.codec_type === "audio");
  checks.push({
    name: "audio stream present",
    passed: Boolean(audioStream),
    detail: audioStream ? `codec ${audioStream.codec_name}` : "no audio stream found",
  });

  const resolutionOk = videoStream?.width === EXPECTED_WIDTH && videoStream?.height === EXPECTED_HEIGHT;
  checks.push({
    name: `resolution is ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT}`,
    passed: Boolean(resolutionOk),
    detail: videoStream ? `${videoStream.width}x${videoStream.height}` : "unknown (no video stream)",
  });

  const durationSeconds = Number(ffprobe.format.duration);
  const durationSane = Number.isFinite(durationSeconds) && durationSeconds > 0;
  checks.push({
    name: "duration is a sane positive number",
    passed: durationSane,
    detail: `${ffprobe.format.duration ?? "missing"}`,
  });

  const durationMatchesNarration =
    durationSane && Math.abs(durationSeconds - expectedDurationSeconds) <= DURATION_TOLERANCE_SECONDS;
  checks.push({
    name: `duration within ${DURATION_TOLERANCE_SECONDS}s of expected (${expectedDurationSeconds.toFixed(1)}s)`,
    passed: durationMatchesNarration,
    detail: durationSane ? `actual ${durationSeconds.toFixed(1)}s` : "duration unknown",
  });

  checks.push({
    name: "output file is non-empty",
    passed: fileSizeBytes > 0,
    detail: `${fileSizeBytes} bytes`,
  });

  return { passed: checks.every((c) => c.passed), checks };
}
