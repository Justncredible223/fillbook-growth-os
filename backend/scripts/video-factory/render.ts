import { copyFileSync, existsSync, writeFileSync } from "node:fs";
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
 * UI-screenshot scenes show the app in a window between two dark bands: the
 * top one holds the SceneLabel ("FILLBOOK · EXAMPLE DATA", MarginV=140, also
 * clear of TikTok's top UI) and the bottom one holds the burned-in captions
 * (MarginV=450, whose top edge measures ~510px from the bottom -- see
 * captions.ts), so neither draws over the screenshot's own text.
 */
const UI_TOP_BAND = 230;
const UI_BOTTOM_BAND = 520;
const UI_WINDOW_HEIGHT = HEIGHT - UI_TOP_BAND - UI_BOTTOM_BAND;
/**
 * The app's own page background (measured: RGB 6,10,13), used for every pad
 * around a screenshot so there's no visible seam where the image ends. A
 * screenshot shorter than the window is centered vertically in it (padding
 * y = (oh-ih)/2); a taller one pans instead.
 */
const UI_BACKGROUND = "0x060a0d";

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
 * This is the DEFAULT bed (used when a plan names no track); real renders
 * pick a track and a start offset per video via music.ts, so any .mp3 added
 * to assets/music/ joins the rotation.
 */
const MUSIC_ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets", "music", "ambient-technology.mp3");
const MUSIC_BASENAME = "ambient-technology.mp3";

/**
 * Music level BEFORE ducking, i.e. how loud it sits in the gaps between
 * words. Higher than the old flat 0.13 because it no longer has to stay
 * quiet enough for speech on its own -- the sidechain compressor pulls it
 * down ~10dB while the voice is talking (threshold 0.06, ratio 4).
 */
const MUSIC_VOLUME = 0.2;
const DUCK_THRESHOLD = 0.06;
const DUCK_RATIO = 4;
const DUCK_ATTACK_MS = 15;
const DUCK_RELEASE_MS = 350;
/** TikTok's playback loudness target. */
const TARGET_LUFS = -14;

/** Hook scenes push in by this fraction over HOOK_ZOOM_SECONDS, under a black scrim of HOOK_SCRIM_OPACITY. */
const HOOK_ZOOM_AMOUNT = 0.1;
const HOOK_ZOOM_SECONDS = 2.5;
const HOOK_SCRIM_OPACITY = 0.35;

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
 * Timeline that keeps every scene cut on its intended timestamp. A plain
 * chained xfade shortens the video by the sum of all transition overlaps
 * (computeSceneTransitions' cumulativeDurationSeconds), so with many short
 * scenes the visuals would drift earlier than the narration and captions
 * and end before the audio does. Fix: extend each scene's input by the
 * length of the transition INTO the next scene and start each transition
 * exactly at the intended boundary (running sum of the planned durations).
 * The final video length then equals the sum of `durations` exactly.
 * Transition lengths use the same caps as computeSceneTransitions.
 */
export function computeSyncedSceneTimeline(durations: number[]): { inputDurations: number[]; transitions: SceneTransition[] } {
  const transitions: SceneTransition[] = [];
  const inputDurations = [...durations];
  let boundary = 0;
  for (let i = 1; i < durations.length; i++) {
    boundary += durations[i - 1]!;
    const duration = Math.min(MAX_TRANSITION_SECONDS, TRANSITION_FRACTION_OF_SHORTER_SCENE * Math.min(durations[i - 1]!, durations[i]!));
    transitions.push({ durationSeconds: duration, offsetSeconds: boundary });
    inputDurations[i - 1] = durations[i - 1]! + duration;
  }
  return { inputDurations, transitions };
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

  const { inputDurations, transitions } = computeSyncedSceneTimeline(plan.scenes.map((s) => s.durationSeconds));

  const inputArgs: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    // Each input runs a transition-length past its planned duration -- see computeSyncedSceneTimeline.
    const inputDuration = inputDurations[i]!;
    if (scene.imagePath) {
      // UI screenshot: a still looped at the render's frame rate for the
      // scene's duration; the filter graph below pans down over it.
      inputArgs.push(
        "-loop", "1",
        "-framerate", String(FRAME_RATE),
        "-t", inputDuration.toFixed(3),
        "-i", renderBasename(scene.imagePath),
      );
    } else if (scene.clipPath) {
      // Loop the clip to fill the scene duration exactly
      inputArgs.push(
        "-stream_loop", "-1",
        "-t", inputDuration.toFixed(3),
        "-i", renderBasename(scene.clipPath),
      );
    } else {
      // Fallback: solid color lavfi source
      inputArgs.push(
        "-f", "lavfi",
        "-i", `color=c=${scene.backgroundColor}:s=${WIDTH}x${HEIGHT}:d=${inputDuration.toFixed(3)}:r=${FRAME_RATE}`,
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
  // -ss seeks into the chosen track (see music.ts) so renders use different stretches of it.
  const musicStart = plan.musicStartSeconds ?? 0;
  inputArgs.push(
    "-stream_loop", "-1",
    ...(musicStart > 0 ? ["-ss", musicStart.toFixed(1)] : []),
    "-t", plan.totalDurationSeconds.toFixed(3),
    "-i", plan.musicFile ? renderBasename(plan.musicFile) : MUSIC_BASENAME,
  );

  // Scale each scene clip to 1080×1920 (center-crop to fill, maintain no distortion)
  const sceneFilterParts: string[] = [];
  const sceneOutputLabels: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    // Non-null: i is bounded by plan.scenes.length in the loop condition
    // above, so this index access is always in range -- TS's
    // noUncheckedIndexedAccess can't see that from a numeric for-loop.
    const scene = plan.scenes[i]!;
    const label = `sv${i}`;
    sceneOutputLabels.push(label);
    if (scene.imagePath) {
      // Fit to canvas width, pad short screenshots to the window height on
      // the brand-dark background, then scroll a 1080xUI_WINDOW_HEIGHT window
      // from the top of the screenshot to the bottom over the scene, and pad
      // the result back to 1080x1920. The dark bands above/below keep the
      // top-anchored scene label and the bottom-anchored captions off the
      // screenshot's own text (see UI_TOP_BAND/UI_BOTTOM_BAND). Expressions are single-quoted
      // so their commas aren't read as filter separators. format=yuv420p
      // because JPEG decodes to yuvj420p, which xfade won't mix with the
      // other scenes' yuv420p.
      const panSeconds = Math.max(inputDurations[i]!, 0.1).toFixed(3);
      sceneFilterParts.push(
        `[${i}:v]scale=${WIDTH}:-2,pad=${WIDTH}:'max(ih,${UI_WINDOW_HEIGHT})':0:'(oh-ih)/2':color=${UI_BACKGROUND},` +
          `crop=${WIDTH}:${UI_WINDOW_HEIGHT}:0:'(in_h-${UI_WINDOW_HEIGHT})*min(t/${panSeconds},1)',` +
          `pad=${WIDTH}:${HEIGHT}:0:${UI_TOP_BAND}:color=${UI_BACKGROUND},fps=${FRAME_RATE},setsar=1:1,format=yuv420p,setpts=PTS-STARTPTS[${label}]`,
      );
    } else if (scene.clipPath) {
      // Hook scenes (the first ~2-3s, when a viewer decides to stay) get a
      // slow push-in plus a dark scrim so the big centered hook text is
      // legible over any stock footage. The zoom rescales every frame from
      // its own timestamp (setpts above resets t to 0 per scene) and crops
      // back to the canvas, so it costs nothing outside hook scenes.
      const hookTreatment =
        scene.kind === "hook"
          ? `,scale=w='trunc(${WIDTH}*(1+${HOOK_ZOOM_AMOUNT}*min(t/${HOOK_ZOOM_SECONDS},1))/2)*2':h=-2:eval=frame,crop=${WIDTH}:${HEIGHT},` +
            `drawbox=x=0:y=0:w=iw:h=ih:color=black@${HOOK_SCRIM_OPACITY}:t=fill`
          : "";
      sceneFilterParts.push(
        // setsar=1:1 normalises the sample-aspect-ratio metadata that some
      // Pexels clips carry (e.g. SAR 10240:10239) -- without it, concat
      // rejects clips whose SAR differs even by one quantum.
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FRAME_RATE},setsar=1:1,setpts=PTS-STARTPTS${hookTreatment}[${label}]`,
      );
    } else {
      sceneFilterParts.push(`[${i}:v]setpts=PTS-STARTPTS[${label}]`);
    }
  }

  // Chain xfade transitions scene-by-scene: sv0 -> xfade with sv1 -> xf1,
  // xf1 -> xfade with sv2 -> xf2, etc. A single-scene plan has nothing to
  // transition, so the raw scene label is the background directly.
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
    `[${voiceoverInputIndex}:a][${silenceInputIndex}:a]concat=n=2:v=0:a=1[voicefull]`,
    // The voice feeds both the mix and the ducking sidechain.
    `[voicefull]asplit=2[voice][voicesc]`,
    // Short fade-in so a mid-track start never opens on a hard edge.
    `[${musicInputIndex}:a]afade=t=in:st=0:d=0.5,volume=${MUSIC_VOLUME}[musicvol]`,
    // Music ducks under speech (sidechain compression keyed on the voice)
    // and swells back in the gaps, instead of a constant quiet bed.
    `[musicvol][voicesc]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[musicduck]`,
    // duration=first: output length follows the voice+silence track, never
    // the (possibly much longer, now looped-to-fit) music bed. normalize=0
    // keeps the voice at full level (amix would otherwise halve both inputs).
    `[voice][musicduck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]`,
    // Single-pass loudness normalisation to TikTok's ~-14 LUFS playback
    // level, so videos aren't quieter than what's around them in the feed.
    `[mix]loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11,aresample=48000[a]`,
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
    "-crf", "23",
    "-maxrate", "3000k",
    "-bufsize", "6000k",
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
    const musicSource = plan.musicFile ?? MUSIC_ASSET_PATH;
    const musicDest = join(cwd, plan.musicFile ? renderBasename(plan.musicFile) : MUSIC_BASENAME);
    if (!existsSync(musicDest)) copyFileSync(musicSource, musicDest);
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
const THUMBNAIL_BRAND_ASS_BASENAME = "thumbnail-brand.ass";

/**
 * One-line .ass file for the thumbnail badge -- top-left (Alignment=7),
 * well clear of both the bottom-anchored Hook/Caption text (MarginV=450,
 * see captions.ts) and the top-anchored SceneLabel text (MarginV=140).
 * BorderStyle=3 gives an opaque background box behind the text (same look
 * the old drawtext boxcolor/boxborderw was going for); BackColour's
 * leading byte is alpha (ASS is &HAABBGGRR), 0x73 ~= the old box@0.55
 * opacity. PlayResX/Y match the render resolution -- same libass-clipping
 * fix captions.ts's ASS_HEADER doc comment explains. Single Dialogue line
 * spans well past any real thumbnail frame's timestamp (0-10s window vs.
 * -frames:v 1 grabbing pts 0 from the already-extracted still image), so
 * it's always active regardless of `atSeconds`.
 */
function buildThumbnailBrandAss(): string {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ThumbnailBrand,Poppins ExtraBold,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H73000000,1,0,0,0,100,100,0,0,3,8,0,7,32,32,32,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,ThumbnailBrand,,0,0,0,,${THUMBNAIL_SITE_TEXT}`;
}

/**
 * Extracts a single real frame from the finished video as a JPG thumbnail,
 * then burns in a small "fillbookhq.com" badge via a second ffmpeg pass.
 * Two separate ffmpeg calls rather than one combined -ss/-i/-filter_complex
 * invocation: the first stays a plain -ss/-i/-frames:v call (as before) so
 * it's safe to pass a real absolute `videoPath` directly -- no filter-graph
 * syntax there for a Windows drive-letter colon to collide with. The
 * second runs with cwd set to the thumbnail's own directory and references
 * files by plain basename, same basename-only path-safety pattern
 * renderVideo already uses for the bundled caption font.
 *
 * The badge is burned in via the `subtitles` filter over a one-line .ass
 * file (see THUMBNAIL_BRAND_STYLE below), NOT `drawtext` -- an earlier
 * version of this function used drawtext directly for the badge, which
 * never actually showed up on real renders (owner-reported 2026-09-18):
 * drawtext reproducibly segfaults on the ffmpeg build every real render
 * runs on (ubuntu-latest in GitHub Actions -- see captions.ts's own doc
 * comment, which is why every OTHER piece of burned-in text, captions and
 * scene labels alike, already goes through `subtitles` instead). This
 * brings the thumbnail badge in line with that established, verified-
 * working pattern instead of the one path that still used drawtext.
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

  const assPath = join(cwd, THUMBNAIL_BRAND_ASS_BASENAME);
  writeFileSync(assPath, buildThumbnailBrandAss(), "utf-8");

  // Runs with cwd set to the thumbnail's own directory and references
  // files by plain basename inside the filter string -- same basename-
  // only path-safety pattern as renderVideo's bundled font/captions (see
  // that function's own doc comment). Writes directly to `finalBasename`
  // (resolving to the real `thumbnailPath` via `cwd`) so there's no extra
  // copy-back step needed.
  const brandResult = await runner.run(
    "ffmpeg",
    ["-y", "-i", rawBasename, "-vf", `subtitles=${THUMBNAIL_BRAND_ASS_BASENAME}:fontsdir=.`, "-frames:v", "1", "-q:v", "2", finalBasename],
    { cwd },
  );
  if (brandResult.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg thumbnail branding failed (exit ${brandResult.exitCode}):\n${brandResult.stderr || brandResult.stdout}`);
  }
}
