import { copyFileSync, existsSync } from "node:fs";
import { win32 as windowsPath } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import type { RenderPlan } from "./types.js";
import { VideoFactoryError } from "./types.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FRAME_RATE = 30;

/**
 * Bundled caption font (Poppins ExtraBold, OFL-licensed -- see
 * assets/fonts/OFL.txt) -- bolder and more rounded than the Arial/Verdana
 * system fallback libass would otherwise substitute on ubuntu-latest,
 * which has neither font installed.
 */
const FONT_ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets", "fonts", "Poppins-ExtraBold.ttf");
const FONT_BASENAME = "Poppins-ExtraBold.ttf";

/**
 * Bundled background music bed (Pixabay Content License -- free for
 * commercial use, no attribution required; see assets/music/LICENSE.txt)
 * -- added 2026-09-17 as one of two owner-approved render-quality
 * improvements (the other is buildFfmpegArgs's scene crossfades below).
 * One fixed track reused across every render, same reasoning as the one
 * fixed caption font: consistent, recognizable branding rather than a
 * per-video pick, and no extra API/credential surface to fetch a
 * different one each time.
 */
const MUSIC_ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets", "music", "ambient-technology.mp3");
const MUSIC_BASENAME = "ambient-technology.mp3";

/** How quiet the background music sits under the real voiceover -- low enough to never compete with narration, audible enough to fill the silence. */
const MUSIC_VOLUME = 0.13;

/**
 * Crossfade duration between adjacent scenes, replacing the previous hard
 * cut -- added 2026-09-17 (owner-approved render-quality improvement) to
 * soften the "instant scene change" feel of a plain concat. Capped at 30%
 * of whichever adjacent scene is shorter (never more than MAX) so a short
 * scene can never make an xfade `offset` go negative -- see
 * buildFfmpegArgs's chained-xfade offset math for why that bound matters.
 */
const MAX_TRANSITION_SECONDS = 0.4;
const TRANSITION_FRACTION_OF_SHORTER_SCENE = 0.3;

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
 * Chained-xfade offset/duration math for N scene clips, factored out so
 * it's independently unit-testable without constructing a full filter
 * graph string. Each transition's duration is capped at both
 * MAX_TRANSITION_SECONDS and TRANSITION_FRACTION_OF_SHORTER_SCENE of
 * whichever ADJACENT scene is shorter -- this is what guarantees offset_i
 * (= cumulative duration so far, minus this transition's own duration)
 * can never go negative: cumulative after step i-1 is always >=
 * durations[i-1], and t_i <= durations[i-1] * TRANSITION_FRACTION < durations[i-1].
 * Returns one entry per transition (durations.length - 1 entries, empty
 * for a single-scene plan); `cumulativeDurationSeconds` is the resulting
 * total video length after every transition's overlap is applied.
 */
export interface SceneTransition {
  durationSeconds: number;
  offsetSeconds: number;
}

export function computeSceneTransitions(durations: number[]): { transitions: SceneTransition[]; cumulativeDurationSeconds: number } {
  const transitions: SceneTransition[] = [];
  if (durations.length === 0) return { transitions, cumulativeDurationSeconds: 0 };

  let cumulative = durations[0]!;
  for (let i = 1; i < durations.length; i++) {
    const prev = durations[i - 1]!;
    const current = durations[i]!;
    const duration = Math.min(MAX_TRANSITION_SECONDS, TRANSITION_FRACTION_OF_SHORTER_SCENE * Math.min(prev, current));
    const offset = cumulative - duration;
    transitions.push({ durationSeconds: duration, offsetSeconds: offset });
    cumulative = cumulative + current - duration;
  }
  return { transitions, cumulativeDurationSeconds: cumulative };
}

/**
 * Builds the ffmpeg argv for the known-good composite strategy from
 * ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md, extended from a
 * single flat background to N scene-colored segments joined with a short
 * crossfade between each adjacent pair (see computeSceneTransitions --
 * replaced a hard-cut `concat` 2026-09-17, an owner-approved render-
 * quality improvement: an instant scene change reads as more "AI
 * slideshow" than a soft dissolve), then the `subtitles` filter burns in
 * captions + scene labels on top of the composited result (NOT
 * `drawtext`, which reproducibly segfaults on this ffmpeg 9.0.1 build --
 * see captions.ts). Audio is the real voiceover concatenated with a short
 * silence pad so the closing caption has room to breathe, then mixed with
 * a quiet bundled background music bed (also 2026-09-17, same owner
 * approval -- see MUSIC_ASSET_PATH/MUSIC_VOLUME). Pure function, no I/O
 * -- render() below is the only thing that actually shells out, so this
 * is fully unit-testable.
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
  const musicInputIndex = silenceInputIndex + 1;
  inputArgs.push("-i", renderBasename(plan.voiceoverPath));
  inputArgs.push("-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono:d=${plan.silencePadSeconds.toFixed(3)}`);
  // Looped and trimmed to the full video length so a short bundled track
  // (2:20) still covers a longer render; `-shortest` on the final output
  // means an over-long trim here is harmless.
  inputArgs.push("-stream_loop", "-1", "-t", plan.totalDurationSeconds.toFixed(3), "-i", MUSIC_BASENAME);

  // Scale each scene clip to 1080×1920 (center-crop to fill, maintain no distortion)
  const sceneFilterParts: string[] = [];
  const sceneOutputLabels: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i];
    const label = `sv${i}`;
    sceneOutputLabels.push(label);
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

  // Chain xfade transitions scene-by-scene: sv0 -> xfade with sv1 -> xf1,
  // xf1 -> xfade with sv2 -> xf2, etc. A single-scene plan has nothing to
  // transition, so the raw scene label is the background directly.
  const { transitions } = computeSceneTransitions(plan.scenes.map((s) => s.durationSeconds));
  let bgLabel = sceneOutputLabels[0]!;
  const xfadeParts: string[] = [];
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i]!;
    const nextLabel = `xf${i}`;
    xfadeParts.push(
      `[${bgLabel}][${sceneOutputLabels[i + 1]}]xfade=transition=fade:duration=${t.durationSeconds.toFixed(3)}:offset=${t.offsetSeconds.toFixed(3)}[${nextLabel}]`,
    );
    bgLabel = nextLabel;
  }

  const filterComplex = [
    ...sceneFilterParts,
    ...xfadeParts,
    // fontsdir=. (relative to ffmpeg's own cwd, the render's output
    // directory -- see renderVideo) points libass at the bundled caption
    // font copied there below, same basename-only path-safety reasoning as
    // every other file in this filter graph.
    `[${bgLabel}]subtitles=${renderBasename(plan.assPath)}:fontsdir=.[v]`,
    `[${voiceoverInputIndex}:a][${silenceInputIndex}:a]concat=n=2:v=0:a=1[voice]`,
    `[${musicInputIndex}:a]volume=${MUSIC_VOLUME}[musicvol]`,
    // duration=first: output length follows the voice+silence track, never
    // the (possibly much longer, now looped-to-fit) music bed.
    `[voice][musicvol]amix=inputs=2:duration=first:dropout_transition=0[a]`,
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
  const cwd = renderDirname(plan.outputPath);
  // Best-effort: the bundled font is a visual nicety, not a correctness
  // requirement -- if the output directory isn't writable/doesn't exist
  // yet for some reason, libass just falls back to fontconfig's own
  // substitute for "Poppins ExtraBold" rather than failing the whole
  // render over caption styling.
  try {
    const fontDest = join(cwd, FONT_BASENAME);
    if (!existsSync(fontDest)) copyFileSync(FONT_ASSET_PATH, fontDest);
  } catch {
    // Deliberately swallowed -- see comment above.
  }
  // Same copy-into-cwd/basename-reference and best-effort-swallow pattern
  // as the font above. Unlike the font, a failed copy here has no
  // fontconfig-style automatic substitute -- ffmpeg will fail the render
  // with its own "No such file or directory" on the music input, which is
  // an acceptable, honest failure mode for a directory-not-writable
  // situation this rare (the same directory already has to be writable
  // for voiceover.mp3/captions.ass to exist there at all).
  try {
    const musicDest = join(cwd, MUSIC_BASENAME);
    if (!existsSync(musicDest)) copyFileSync(MUSIC_ASSET_PATH, musicDest);
  } catch {
    // Deliberately swallowed -- see comment above.
  }

  const args = buildFfmpegArgs(plan);
  const result = await runner.run("ffmpeg", args, { cwd });
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg render failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
}

/**
 * Site-branding text burned onto every generated thumbnail -- added
 * 2026-09-17 (owner request: thumbnails should carry the site, not rely
 * on whatever the hook caption happens to say at that frame). The hook
 * caption is about the video's content, not the brand, so a thumbnail
 * grabbed from it alone can easily never mention Fillbook at all.
 */
const THUMBNAIL_SITE_TEXT = "fillbookhq.com";

/**
 * Extracts a single real frame from the finished video as a JPG thumbnail,
 * then burns in a small "fillbookhq.com" badge via a second, simple
 * drawtext-only ffmpeg pass. Two separate ffmpeg calls rather than one
 * combined -ss/-i/-filter_complex invocation: the first stays a plain
 * -ss/-i/-frames:v call (as before) so it's safe to pass a real absolute
 * `videoPath` directly -- no filter-graph syntax there for a Windows
 * drive-letter colon to collide with. The second runs with cwd set to the
 * thumbnail's own directory and references it by plain basename inside
 * the drawtext filter string, same basename-only path-safety pattern
 * renderVideo already uses for the bundled caption font (see that
 * function's own doc comment) -- drawtext's `text=`/`fontfile=` params use
 * colon-delimited syntax, which a raw Windows path would collide with.
 * Callers should pick `atSeconds` to land inside the Hook caption's
 * on-screen window so the frame also has bold on-brand hook text on it
 * (see captions.ts's getHookMidpointSeconds).
 */
export async function extractThumbnail(videoPath: string, atSeconds: number, thumbnailPath: string, runner: ProcessRunner): Promise<void> {
  const cwd = renderDirname(thumbnailPath);
  const finalBasename = renderBasename(thumbnailPath);
  const rawBasename = `raw-${finalBasename}`;
  const rawPath = join(cwd, rawBasename);

  const rawResult = await runner.run("ffmpeg", [
    "-y",
    "-ss",
    Math.max(0, atSeconds).toFixed(3),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    rawPath,
  ]);
  if (rawResult.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg thumbnail extraction failed (exit ${rawResult.exitCode}):\n${rawResult.stderr || rawResult.stdout}`);
  }

  // Best-effort font copy -- same reasoning as renderVideo: a visual
  // nicety, not a correctness requirement. Falls back to fontconfig's own
  // substitute if the copy fails for any reason.
  try {
    const fontDest = join(cwd, FONT_BASENAME);
    if (!existsSync(fontDest)) copyFileSync(FONT_ASSET_PATH, fontDest);
  } catch {
    // Deliberately swallowed -- see comment above.
  }

  // Top-left badge, well clear of both the bottom-anchored Hook/Caption
  // text (MarginV=320, see captions.ts) and the top-anchored SceneLabel
  // text (MarginV=140) -- a slim strip right at the top edge sits above
  // where SceneLabel's own margin would ever place it. Runs with cwd set
  // to the thumbnail's own directory and references files by plain
  // basename inside the filter string -- same basename-only path-safety
  // pattern as renderVideo's bundled font (see that function's own doc
  // comment); drawtext's `text=`/`fontfile=` params use colon-delimited
  // syntax, which a raw Windows path would collide with. Writes directly
  // to `finalBasename` (resolving to the real `thumbnailPath` via `cwd`)
  // so there's no extra copy-back step needed.
  const drawtext = [
    `text='${THUMBNAIL_SITE_TEXT}'`,
    "fontfile=" + FONT_BASENAME,
    "fontsize=44",
    "fontcolor=white",
    "x=32",
    "y=32",
    "box=1",
    "boxcolor=black@0.55",
    "boxborderw=16",
  ].join(":");

  const brandResult = await runner.run(
    "ffmpeg",
    ["-y", "-i", rawBasename, "-vf", `drawtext=${drawtext}`, "-frames:v", "1", "-q:v", "2", finalBasename],
    { cwd },
  );
  if (brandResult.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg thumbnail branding failed (exit ${brandResult.exitCode}):\n${brandResult.stderr || brandResult.stdout}`);
  }
}
