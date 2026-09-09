import { win32 as windowsPath } from "node:path";
import type { ProcessRunner } from "./processRunner.js";
import type { RenderPlan } from "./types.js";
import { VideoFactoryError } from "./types.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FRAME_RATE = 30;

/**
 * Path helpers that understand BOTH separators regardless of the host OS.
 * `node:path`'s default export follows the current platform: on Linux/
 * macOS `basename("C:\\out\\draft-1\\voiceover.mp3")` returns the whole
 * string and `dirname(...)` returns ".", which would put a raw Windows
 * path (drive-letter colon, backslashes) straight into the ffmpeg filter
 * graph -- the exact breakage this module exists to avoid -- and run
 * ffmpeg in the wrong directory. `path.win32` treats "/" and "\\" as
 * separators, so a plan built on either OS renders identically on either
 * OS; the only thing given up is a POSIX filename that itself contains a
 * backslash, which this pipeline never produces.
 */
export function renderBasename(filePath: string): string {
  return windowsPath.basename(filePath);
}

export function renderDirname(filePath: string): string {
  return windowsPath.dirname(filePath);
}

/**
 * Builds the ffmpeg argv for the known-good composite strategy from
 * ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md, extended from a
 * single flat background to N scene-colored segments concatenated
 * end-to-end: one `color` lavfi source per scene, concatenated on the
 * video track, then the `subtitles` filter burns in captions + scene
 * labels on top of the composited result (NOT `drawtext`, which
 * reproducibly segfaults on this ffmpeg 9.0.1 build -- see captions.ts).
 * Audio is the real voiceover concatenated with a short silence pad so
 * the closing caption has room to breathe, same as the known-good
 * example. Pure function, no I/O -- render() below is the only thing
 * that actually shells out, so this is fully unit-testable.
 *
 * Every file is referenced by basename only (see renderBasename): the
 * filter graph must never see an absolute path.
 */
export function buildFfmpegArgs(plan: RenderPlan): string[] {
  if (plan.scenes.length === 0) throw new VideoFactoryError("Render plan has no scenes.");

  const inputArgs: string[] = [];
  for (const scene of plan.scenes) {
    if (scene.clipPath) {
      // Loop the clip to fill the scene duration exactly
      inputArgs.push(
        "-stream_loop", "-1",
        "-t", scene.durationSeconds.toFixed(3),
        "-i", renderBasename(scene.clipPath),
      );
    } else {
      // Fallback: solid color lavfi source
      inputArgs.push(
        "-f", "lavfi",
        "-i", `color=c=${scene.backgroundColor}:s=${WIDTH}x${HEIGHT}:d=${scene.durationSeconds.toFixed(3)}:r=${FRAME_RATE}`,
      );
    }
  }
  const voiceoverInputIndex = plan.scenes.length;
  const silenceInputIndex = voiceoverInputIndex + 1;
  inputArgs.push("-i", renderBasename(plan.voiceoverPath));
  inputArgs.push("-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono:d=${plan.silencePadSeconds.toFixed(3)}`);

  // Scale each scene clip to 1080×1920 (center-crop to fill, maintain no distortion)
  const sceneFilterParts: string[] = [];
  const sceneOutputLabels: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    const label = `sv${i}`;
    sceneOutputLabels.push(`[${label}]`);
    if (scene.clipPath) {
      sceneFilterParts.push(
        // setsar=1:1 normalises the sample-aspect-ratio metadata that some
      // Pexels clips carry (e.g. SAR 10240:10239) -- without it, concat
      // rejects clips whose SAR differs even by one quantum.
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FRAME_RATE},setsar=1:1,setpts=PTS-STARTPTS[${label}]`,
      );
    } else {
      sceneFilterParts.push(`[${i}:v]setpts=PTS-STARTPTS[${label}]`);
    }
  }

  const concatInputs = sceneOutputLabels.join("");
  const filterComplex = [
    ...sceneFilterParts,
    `${concatInputs}concat=n=${plan.scenes.length}:v=1:a=0[bgraw]`,
    `[bgraw]subtitles=${renderBasename(plan.assPath)}[v]`,
    `[${voiceoverInputIndex}:a][${silenceInputIndex}:a]concat=n=2:v=0:a=1[a]`,
  ].join(";");

  return [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-crf", "18",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    renderBasename(plan.outputPath),
  ];
}

/**
 * Runs ffmpeg with cwd set to the render's output directory so the
 * filter_complex string can reference voiceover.mp3/captions.ass/
 * final.mp4 by plain basename -- sidesteps ffmpeg filter syntax's fragile
 * escaping of Windows absolute paths (colons, backslashes) entirely,
 * same fix the known-good pipeline used ("cd into the working folder
 * first"). The cwd is derived with renderDirname so it is correct on
 * every host OS, not only Windows.
 */
export async function renderVideo(plan: RenderPlan, runner: ProcessRunner): Promise<void> {
  const args = buildFfmpegArgs(plan);
  const cwd = renderDirname(plan.outputPath);
  const result = await runner.run("ffmpeg", args, { cwd });
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg render failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
}
