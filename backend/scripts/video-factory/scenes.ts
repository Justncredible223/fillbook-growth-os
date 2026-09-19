import type { Scene, SceneKind, WordCue } from "./types.js";
import { groupWordsIntoPhrases, type SceneLabelCue } from "./captions.js";

/**
 * Deterministic keyword classification of each approved shot-list entry
 * -- no AI image generation in this phase (explicitly out of scope), just
 * enough visual variety that the background actually changes per beat
 * instead of one flat color for the whole video. Order matters: checked
 * most-specific first so e.g. "Fillbook UI: metric card" classifies as
 * product (a real screenshot reference) rather than metric.
 */
export function classifyShot(description: string, index: number): SceneKind {
  const text = description.toLowerCase();
  if (index === 0) return "hook";
  if (/\b(fillbook ui|screenshot|dashboard|app screen|product screen)\b/.test(text)) return "product";
  if (/\b(cta|call to action|follow|download|try fillbook|link in bio|sign up)\b/.test(text)) return "cta";
  // \d and % aren't word characters on both sides, so \b(\d|%)\b never
  // matches multi-digit numbers or a bare "%" -- tested separately.
  if (/\d|%/.test(text) || /\b(percent|number|stat|metric|chart|graph)\b/.test(text)) return "metric";
  return "explanation";
}

/**
 * Deliberately NOT fabricated product screenshots or stock imagery --
 * "product" shots get a distinctly different, slightly cooler-toned card
 * than plain text scenes to visually signal "this is the app" even
 * though this phase renders it as a labeled color card, not a real
 * screenshot. Same solid-color-card technique as the known-good Day 1
 * pipeline (~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md), which
 * used `color=c=0x05070a` for the whole video -- these are brand-dark
 * variants of that same base, not arbitrary colors.
 */
const SCENE_COLORS: Record<SceneKind, string> = {
  hook: "0x05070a",
  explanation: "0x05070a",
  metric: "0x0a0e16",
  product: "0x0d1420",
  cta: "0x120a05",
};

/**
 * Short on-screen label per scene, burned in via the ASS "SceneLabel"
 * style (see captions.ts) -- never drawtext, which segfaults on this
 * ffmpeg build. Hook/explanation scenes get NO label: the spoken hook/
 * script caption already carries that content, and the raw shot-list
 * description (internal shot-direction text, e.g. "Text card: the hook
 * line") is never something a viewer should see burned into the video.
 * Only product/metric/cta scenes get a short, fixed, viewer-safe tag.
 */
function labelForScene(kind: SceneKind): string {
  const label: Record<SceneKind, string> = {
    hook: "",
    explanation: "",
    metric: "📊",
    product: "FILLBOOK",
    cta: "TRY FILLBOOK",
  };
  return label[kind];
}

/** Retention-driven pacing: visuals should change at least every ~3s, but never so fast a cut can't register. */
const MAX_SCENE_SECONDS = 3;
const MIN_SCENE_SECONDS = 1;
/** How far a cut may move off its ideal even-spacing time to land on a phrase boundary. */
const SNAP_WINDOW_SECONDS = 0.9;

/**
 * Picks `sceneCount - 1` ascending cut times. Each cut aims for even
 * spacing across the narration, then snaps to the nearest phrase start
 * (a natural pause/sentence break, see groupWordsIntoPhrases) within
 * SNAP_WINDOW_SECONDS, so visuals change when the speaker moves to a new
 * thought instead of mid-phrase. Every scene stays >= MIN_SCENE_SECONDS.
 */
function planCutTimes(wordCues: WordCue[], totalDurationSeconds: number, voiceEndSeconds: number, sceneCount: number): number[] {
  const phraseStarts = groupWordsIntoPhrases(wordCues)
    .slice(1)
    .map((phrase) => phrase[0]!.startSeconds);
  const cuts: number[] = [];
  let previous = 0;
  for (let k = 1; k < sceneCount; k++) {
    const ideal = (k * voiceEndSeconds) / sceneCount;
    const earliest = previous + MIN_SCENE_SECONDS;
    const latest = totalDurationSeconds - (sceneCount - k) * MIN_SCENE_SECONDS;
    let best: number | null = null;
    for (const start of phraseStarts) {
      if (start < earliest || start > latest || Math.abs(start - ideal) > SNAP_WINDOW_SECONDS) continue;
      if (best === null || Math.abs(start - ideal) < Math.abs(best - ideal)) best = start;
    }
    const cut = best ?? Math.min(Math.max(ideal, earliest), latest);
    cuts.push(cut);
    previous = cut;
  }
  return cuts;
}

/**
 * Builds the scene plan. Without word timing it splits total duration
 * evenly across the shot list (the LLM's shot list isn't time-coded, so
 * mapping shots to specific sentences would be a guess dressed up as
 * precision). With word timing (the normal render path) it instead:
 *  - paces scenes to <= MAX_SCENE_SECONDS, repeating a shot's scene kind
 *    across several cuts when the shot list is shorter than the pacing
 *    needs (each cut gets its own stock clip);
 *  - places every cut on a narration phrase boundary (planCutTimes).
 * Shot-to-narration mapping stays proportional, not semantic. See
 * docs/VIDEO_FACTORY.md's Known Limitations section.
 */
export function buildScenePlan(shotList: string[], totalDurationSeconds: number, wordCues?: WordCue[]): Scene[] {
  if (shotList.length === 0) {
    throw new Error("Cannot build a scene plan from an empty shot list.");
  }
  const makeScene = (shotIndex: number, durationSeconds: number): Scene => {
    const kind = classifyShot(shotList[shotIndex]!, shotIndex);
    return { kind, label: labelForScene(kind), durationSeconds, backgroundColor: SCENE_COLORS[kind] };
  };

  if (!wordCues || wordCues.length === 0) {
    const perScene = totalDurationSeconds / shotList.length;
    return shotList.map((_, i) => makeScene(i, perScene));
  }

  const voiceEndSeconds = Math.min(wordCues[wordCues.length - 1]!.endSeconds, totalDurationSeconds);
  const sceneCount = Math.max(
    1,
    Math.min(Math.max(shotList.length, Math.ceil(voiceEndSeconds / MAX_SCENE_SECONDS)), Math.floor(totalDurationSeconds / MIN_SCENE_SECONDS)),
  );
  const cuts = planCutTimes(wordCues, totalDurationSeconds, voiceEndSeconds, sceneCount);
  const boundaries = [0, ...cuts, totalDurationSeconds];
  return Array.from({ length: sceneCount }, (_, j) =>
    makeScene(Math.floor((j * shotList.length) / sceneCount), boundaries[j + 1]! - boundaries[j]!),
  );
}

/** Converts a scene plan into timed SceneLabel dialogue cues for the .ass file. */
export function buildSceneLabelCues(scenes: Scene[]): SceneLabelCue[] {
  const cues: SceneLabelCue[] = [];
  let elapsed = 0;
  for (const scene of scenes) {
    if (scene.label) {
      cues.push({ label: scene.label, startSeconds: elapsed, endSeconds: elapsed + scene.durationSeconds });
    }
    elapsed += scene.durationSeconds;
  }
  return cues;
}

/**
 * Picks the timestamp for the thumbnail frame -- the midpoint of the
 * best real scene available, not just "whatever's at the Hook's
 * midpoint" (the old behavior, which always landed in the first scene
 * and produced a flat brand-color card whenever no stock clip loaded
 * for it, even when a later scene had real stock footage). "Best" means
 * a scene with actual stock footage (`clipPath` set, not a flat color
 * card), preferring a non-hook scene so the thumbnail shows real footage
 * variety rather than always the opening beat. Falls back to
 * `fallbackSeconds` (the Hook midpoint) only when no scene has real
 * footage at all -- every scene rendered as a flat color card, so no
 * timestamp is visually "better" than any other.
 */
export function selectBestThumbnailSeconds(scenes: Scene[], fallbackSeconds: number | null): number | null {
  let elapsed = 0;
  const withFootage: Array<{ midSeconds: number; kind: SceneKind }> = [];
  for (const scene of scenes) {
    if (scene.clipPath) {
      withFootage.push({ midSeconds: elapsed + scene.durationSeconds / 2, kind: scene.kind });
    }
    elapsed += scene.durationSeconds;
  }
  if (withFootage.length === 0) return fallbackSeconds;
  const nonHook = withFootage.find((s) => s.kind !== "hook");
  return (nonHook ?? withFootage[0]!).midSeconds;
}
