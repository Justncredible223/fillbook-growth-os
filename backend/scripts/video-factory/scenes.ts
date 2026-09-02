import type { Scene, SceneKind } from "./types.js";
import type { SceneLabelCue } from "./captions.js";

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

/**
 * Splits total video duration evenly across the approved shot list.
 * There's no per-shot narration timing to align against (the LLM's shot
 * list isn't time-coded, and mapping shots to specific sentences would
 * be a guess dressed up as precision) -- an even split is the honest
 * deterministic choice here, documented rather than silently assumed.
 * See docs/VIDEO_FACTORY.md's Known Limitations section.
 */
export function buildScenePlan(shotList: string[], totalDurationSeconds: number): Scene[] {
  if (shotList.length === 0) {
    throw new Error("Cannot build a scene plan from an empty shot list.");
  }
  const perScene = totalDurationSeconds / shotList.length;
  return shotList.map((description, i) => {
    const kind = classifyShot(description, i);
    return {
      kind,
      label: labelForScene(kind),
      durationSeconds: perScene,
      backgroundColor: SCENE_COLORS[kind],
    };
  });
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
