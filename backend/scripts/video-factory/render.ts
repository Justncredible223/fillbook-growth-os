import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { win32 as windowsPath } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import type { RenderPlan } from "./types.js";
import { VideoFactoryError } from "./types.js";
import { escapeAssText } from "./captions.js";

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
 * Where verified evidence crops sit: y 260-860. TikTok, YouTube Shorts and Reels overlay their like/comment/share
 * column on the right edge from roughly y 880 down, so evidence placed lower ran under it (owner-reported on a real
 * TikTok post, 2026-09-24). Above y 860 the full width is clear.
 */
const EVIDENCE_BAND_TOP = 260;
const EVIDENCE_BAND_HEIGHT = 600;

/**
 * Blends the outer 28px of a verified crop into UI_BACKGROUND (RGB 6,10,13), so a crop that cuts through a card
 * never shows a hard rectangular edge against the padding around it. Over page background it is invisible.
 */
const FEATHER_PX = 28;
const featherWeight = `min(1,min(min(X,W-1-X),min(Y,H-1-Y))/${FEATHER_PX})`;
const CROP_EDGE_FEATHER =
  `format=gbrp,geq=r='6+(r(X,Y)-6)*${featherWeight}':g='10+(g(X,Y)-10)*${featherWeight}':b='13+(b(X,Y)-13)*${featherWeight}',format=yuv420p`;

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
/** A verified recording's source crop plus any privacy masks (translated into the crop's own coordinates), as filter steps ending in ",". */
function sourceCropTreatment(scene: RenderPlan["scenes"][number]): string {
  if (!scene.sourceCrop) return "";
  const c = scene.sourceCrop;
  let treatment = `crop=${c.w}:${c.h}:${c.x}:${c.y},`;
  for (const mask of scene.privacyMasks ?? []) {
    const mx = mask.x - c.x;
    const my = mask.y - c.y;
    // Skip a mask that falls entirely outside the crop -- nothing left to hide once cropped out already.
    if (mx + mask.w <= 0 || my + mask.h <= 0 || mx >= c.w || my >= c.h) continue;
    treatment += `drawbox=x=${mx}:y=${my}:w=${mask.w}:h=${mask.h}:color=black:t=fill,`;
  }
  return treatment;
}

/**
 * Card layout for verified-evidence scenes: the crop is scaled to fit CARD_MAX_WIDTH x CARD_MAX_HEIGHT (at most
 * 1.25x up) and centered in the band starting at CARD_BAND_TOP. 760px wide keeps its right edge (x<=920) clear of
 * the TikTok/Shorts/Reels action column at any height; the headline and caption start just below it. A short card
 * that still ends above ACTION_COLUMN_TOP when scaled to CARD_WIDE_MAX_WIDTH uses that width instead.
 */
export const CARD_MAX_WIDTH = 760;
export const CARD_MAX_HEIGHT = 860;
export const CARD_BAND_TOP = 280;
export const CARD_UNIT_CENTER_Y = 980;
/** Width a card may use when it ends above ACTION_COLUMN_TOP, where TikTok/Shorts/Reels start their right-hand buttons. */
const CARD_WIDE_MAX_WIDTH = 1000;
const ACTION_COLUMN_TOP = 870;
const CARD_TEXT_GAP = 64;
const CARD_TEXT_BLOCK_ESTIMATE = 260;
export const CARD_SHADOW_SPREAD = 40;
export const CARD_SHADOW_DROP = 22;
/** App cards are 16 CSS px rounded at 2.5x capture scale. */
const SOURCE_CARD_RADIUS = 40;

export interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  textTop: number;
}

export function computeCardLayout(cropWidth: number, cropHeight: number): CardLayout {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const centeredTop = (h: number) => Math.round(CARD_UNIT_CENTER_Y - (h + CARD_TEXT_GAP + CARD_TEXT_BLOCK_ESTIMATE) / 2);
  // A short card may run nearly full width, as long as it ends above the platforms' action column.
  const wideScale = Math.min(CARD_WIDE_MAX_WIDTH / cropWidth, 1.25);
  const wideHeight = even(cropHeight * wideScale);
  if (CARD_BAND_TOP + wideHeight <= ACTION_COLUMN_TOP) {
    const width = even(cropWidth * wideScale);
    const y = Math.min(ACTION_COLUMN_TOP - wideHeight, Math.max(CARD_BAND_TOP, centeredTop(wideHeight)));
    return { x: (WIDTH - width) / 2, y, width, height: wideHeight, radius: Math.round(SOURCE_CARD_RADIUS * wideScale), textTop: y + wideHeight + CARD_TEXT_GAP };
  }
  const scale = Math.min(CARD_MAX_WIDTH / cropWidth, CARD_MAX_HEIGHT / cropHeight, 1.25);
  const width = even(cropWidth * scale);
  const height = even(cropHeight * scale);
  // Center the card plus its text block (estimated) around CARD_UNIT_CENTER_Y, never above CARD_BAND_TOP.
  const y = Math.max(CARD_BAND_TOP, Math.round(CARD_UNIT_CENTER_Y - (height + CARD_TEXT_GAP + CARD_TEXT_BLOCK_ESTIMATE) / 2));
  return { x: (WIDTH - width) / 2, y, width, height, radius: Math.round(SOURCE_CARD_RADIUS * scale), textTop: y + height + CARD_TEXT_GAP };
}

export function buildFfmpegArgs(plan: RenderPlan): string[] {
  if (plan.scenes.length === 0) throw new VideoFactoryError("Render plan has no scenes.");

  const { inputDurations, transitions } = computeSyncedSceneTimeline(plan.scenes.map((s) => s.durationSeconds));

  const inputArgs: string[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const scene = plan.scenes[i]!;
    // Each input runs a transition-length past its planned duration -- see computeSyncedSceneTimeline.
    const inputDuration = inputDurations[i]!;
    if (scene.card && !scene.clipPath && !scene.imagePath) {
      inputArgs.push("-loop", "1", "-framerate", String(FRAME_RATE), "-t", inputDuration.toFixed(3), "-i", renderBasename(scene.card.backgroundPath));
    } else if (scene.imagePath) {
      // UI screenshot: a still looped at the render's frame rate for the
      // scene's duration; the filter graph below pans down over it.
      inputArgs.push(
        "-loop", "1",
        "-framerate", String(FRAME_RATE),
        "-t", inputDuration.toFixed(3),
        "-i", renderBasename(scene.imagePath),
      );
    } else if (scene.clipPath && scene.clipTimeRangeSeconds) {
      // A real, verified recording -- trimmed to the declared range and
      // played once, NEVER -stream_loop'd to stretch a short capture to
      // fill the gap (that would silently fabricate motion that was never
      // actually recorded). inputDuration already includes this scene's
      // adjacent transition padding (see computeSyncedSceneTimeline), so the
      // available footage must cover THAT, not just durationSeconds -- an
      // insufficient range is reported here rather than truncated quietly.
      const { start, end } = scene.clipTimeRangeSeconds;
      const available = end - start;
      if (available < inputDuration - 0.02) {
        throw new VideoFactoryError(
          `Scene ${i} ("${scene.label || scene.kind}"): declared clip range is ${available.toFixed(2)}s but this scene ` +
            `(including transition padding) needs ${inputDuration.toFixed(2)}s. Refusing to loop a real recording to fill the ` +
            `gap -- capture a longer range or shorten the scene.`,
        );
      }
      inputArgs.push("-ss", start.toFixed(3), "-to", (start + inputDuration).toFixed(3), "-i", renderBasename(scene.clipPath));
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

  // Card evidence scenes composite onto three stills (background, shadow, rounded mask), appended after the audio inputs.
  const cardInputIndex = new Map<number, { background: number; shadow: number; mask: number }>();
  let nextInputIndex = musicInputIndex + 1;
  for (const [i, scene] of plan.scenes.entries()) {
    const evidence = scene.card?.evidence;
    if (!scene.card || !evidence || !scene.clipPath) continue;
    const still = (path: string) => {
      inputArgs.push("-loop", "1", "-framerate", String(FRAME_RATE), "-t", inputDurations[i]!.toFixed(3), "-i", renderBasename(path));
      return nextInputIndex++;
    };
    cardInputIndex.set(i, { background: still(scene.card.backgroundPath), shadow: still(evidence.shadowPath), mask: still(evidence.maskPath) });
  }

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
    const cardInputs = cardInputIndex.get(i);
    if (scene.card && cardInputs && scene.card.evidence) {
      const e = scene.card.evidence;
      sceneFilterParts.push(
        `[${i}:v]${sourceCropTreatment(scene)}scale=${e.width}:${e.height},format=rgba[cr${i}]`,
        `[${cardInputs.mask}:v]format=gray[mk${i}]`,
        `[cr${i}][mk${i}]alphamerge[cd${i}]`,
        `[${cardInputs.background}:v]format=rgba[bg${i}]`,
        `[${cardInputs.shadow}:v]format=rgba[sh${i}]`,
        `[bg${i}][sh${i}]overlay=${e.x - CARD_SHADOW_SPREAD}:${e.y - CARD_SHADOW_SPREAD + CARD_SHADOW_DROP}[cb${i}]`,
        `[cb${i}][cd${i}]overlay=${e.x}:${e.y}:shortest=1,fps=${FRAME_RATE},format=yuv420p,setsar=1:1,setpts=PTS-STARTPTS[${label}]`,
      );
      continue;
    }
    if (scene.card && !scene.clipPath && !scene.imagePath) {
      sceneFilterParts.push(`[${i}:v]scale=${WIDTH}:${HEIGHT},fps=${FRAME_RATE},format=yuv420p,setsar=1:1,setpts=PTS-STARTPTS[${label}]`);
      continue;
    }
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
      // A verified recording's own source crop (e.g. excluding a captured
      // app's sidebar) plus any privacy masks, applied BEFORE the normal
      // scale-to-fill/center-crop step below -- both are no-ops for
      // ordinary stock footage, which declares neither. Mask coordinates
      // are translated into the crop's own coordinate space (mask - crop
      // origin) since everything downstream of the crop no longer has the
      // original frame's coordinates.
      const sourceTreatment = sourceCropTreatment(scene);
      // A verified-evidence crop is FIT (never zoom-cropped) into the evidence safe band: below the scene label and
      // above the point where TikTok/Shorts/Reels overlay their right-hand action column, so no card runs under it.
      const fillTreatment = scene.sourceCrop
        ? `scale=${WIDTH}:${EVIDENCE_BAND_HEIGHT}:force_original_aspect_ratio=decrease:force_divisible_by=2,${CROP_EDGE_FEATHER},` +
          `pad=${WIDTH}:${HEIGHT}:'(ow-iw)/2':'${EVIDENCE_BAND_TOP}+(${EVIDENCE_BAND_HEIGHT}-ih)/2':color=${UI_BACKGROUND}`
        : `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`;
      sceneFilterParts.push(
        // setsar=1:1 normalises the sample-aspect-ratio metadata that some
      // Pexels clips carry (e.g. SAR 10240:10239) -- without it, concat
      // rejects clips whose SAR differs even by one quantum.
      `[${i}:v]${sourceTreatment}${fillTreatment},fps=${FRAME_RATE},setsar=1:1,setpts=PTS-STARTPTS${hookTreatment}[${label}]`,
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
 * on whatever the hook caption happens to say at that frame).
 */
const THUMBNAIL_SITE_TEXT = "fillbookhq.com";
const THUMBNAIL_ASS_BASENAME = "thumbnail-card.ass";
/** Same brand-dark base the hook scene itself renders on (see scenes.ts's SCENE_COLORS). */
const THUMBNAIL_BACKGROUND_COLOR = "0x05070a";
/** Brand cyan, matches captions.ts's HIGHLIGHT_COLOR_TAG. */
const THUMBNAIL_TOPIC_COLOR = "&H00EED322&";

/**
 * Thumbnail generation used to grab a real frame from the finished video
 * (`-ss <timestamp> -i video -frames:v 1`). Retired 2026-09-22 (owner-
 * reported: downloaded thumbnails came back blank/corrupted) -- a frame
 * grab is also the wrong shape of "good thumbnail" regardless: it's
 * whatever happened to be on screen at one timestamp, not something that
 * reads the video's actual topic at a glance the way a real YouTube/TikTok
 * thumbnail does. This instead composites a text card, the same way a
 * human would design one: the video's own hook line (already the single
 * most attention-grabbing sentence in the script, see videoScriptWriter.ts's
 * quality bar) large and centered, the campaign topic as a small label
 * above it, and the site badge -- burned onto a flat brand-dark
 * background via the same `subtitles`-over-`color` technique the flat
 * scene cards already use (never `drawtext`, which segfaults on this
 * ffmpeg build -- see captions.ts's own doc comment). No video frame is
 * read at all, so there is nothing for the video's actual content or
 * length to go wrong against.
 */
function buildThumbnailCardAss(hookText: string, topicLabel: string): string {
  const escapedHook = escapeAssText(hookText);
  const escapedTopic = escapeAssText(topicLabel.toUpperCase());
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${WIDTH}
PlayResY: ${HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ThumbnailBrand,Poppins ExtraBold,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H73000000,1,0,0,0,100,100,0,0,3,8,0,7,32,32,32,1
Style: ThumbnailTopic,Poppins ExtraBold,40,${THUMBNAIL_TOPIC_COLOR},${THUMBNAIL_TOPIC_COLOR},&H00000000,&H00000000,1,0,0,0,100,100,4,0,1,4,2,5,80,80,520,1
Style: ThumbnailHook,Poppins ExtraBold,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,9,3,5,80,80,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,ThumbnailBrand,,0,0,0,,${THUMBNAIL_SITE_TEXT}
Dialogue: 0,0:00:00.00,0:00:10.00,ThumbnailTopic,,0,0,0,,${escapedTopic}
Dialogue: 0,0:00:00.00,0:00:10.00,ThumbnailHook,,0,0,0,,${escapedHook}`;
}

/**
 * Renders a designed thumbnail card -- the video's hook line and campaign
 * topic burned over a flat brand-dark background -- as a JPG. See
 * buildThumbnailCardAss's doc comment for why this replaced a real-frame
 * grab. Single ffmpeg pass: `color` lavfi source stands in for a "raw"
 * input, same `subtitles` overlay technique renderVideo and the old
 * extractThumbnail both already use, so there's no new failure mode to
 * reason about.
 */
export async function renderThumbnailCard(
  hookText: string,
  topicLabel: string,
  thumbnailPath: string,
  runner: ProcessRunner,
): Promise<void> {
  const cwd = renderDirname(thumbnailPath);
  const finalBasename = renderBasename(thumbnailPath);

  // Best-effort font copy -- same reasoning as renderVideo: a visual
  // nicety, not a correctness requirement. Falls back to fontconfig's own
  // substitute if the copy fails for any reason.
  try {
    const fontDest = join(cwd, FONT_BASENAME);
    if (!existsSync(fontDest)) copyFileSync(FONT_ASSET_PATH, fontDest);
  } catch {
    // Deliberately swallowed -- see comment above.
  }

  const assPath = join(cwd, THUMBNAIL_ASS_BASENAME);
  writeFileSync(assPath, buildThumbnailCardAss(hookText, topicLabel), "utf-8");

  // Runs with cwd set to the thumbnail's own directory and references the
  // .ass file by plain basename inside the filter string -- same basename-
  // only path-safety pattern as renderVideo's bundled font/captions (see
  // that function's own doc comment).
  const result = await runner.run(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${THUMBNAIL_BACKGROUND_COLOR}:s=${WIDTH}x${HEIGHT}:d=1`,
      "-vf",
      `subtitles=${THUMBNAIL_ASS_BASENAME}:fontsdir=.`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      finalBasename,
    ],
    { cwd },
  );
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffmpeg thumbnail card render failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }
}
