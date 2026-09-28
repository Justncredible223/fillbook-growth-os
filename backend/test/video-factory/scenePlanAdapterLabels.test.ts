import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRenderPlanScenes } from "../../scripts/video-factory/scenePlanAdapter.js";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner.js";
import { loadManifest } from "../../src/shortform/scenePlan.js";
import { PILOTS } from "../../src/shortform/pilots.js";
import type { ScenePlan } from "../../src/shortform/types.js";

const fakeRunner: ProcessRunner = {
  async run(_cmd, args) {
    writeFileSync(args[args.length - 1]!, "");
    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

/**
 * These tests only read caption and label cues. But a plan that carries character beats makes
 * buildRenderPlanScenes render every frame of the character stage through resvg (about 600 real PNGs per plan; the
 * fake runner above only fakes ffmpeg). Doing that for every plan in PILOTS, in two loops, is ~68,000 frames in one
 * process: it exhausted native memory, so this file hung for minutes and then crashed its worker
 * ("memory allocation of 1226880 bytes failed" -- one 1080x284 RGBA frame) on the owner's laptop, on unmodified master,
 * and on GitHub's runners, so its 114 tests never ran anywhere. Nothing below asserts on the characters, so drop them.
 * (Character rendering has its own tests in characters.test.ts.)
 */
const withoutCharacters = (plan: ScenePlan): ScenePlan => ({ ...plan, scenes: plan.scenes.map(({ character: _dropped, ...scene }) => scene) });

describe("buildRenderPlanScenes label cues across fades", () => {
  for (const plan of PILOTS) {
    it(`${plan.planId}: evidence stays under its own label through the outgoing fade, with no overlapping labels`, async () => {
      const adapted = await buildRenderPlanScenes(withoutCharacters(plan), loadManifest(), mkdtempSync(join(tmpdir(), "labels-")), fakeRunner);
      let t = 0;
      for (const [i, s] of plan.scenes.entries()) {
        const end = t + s.durationSeconds;
        const next = plan.scenes[i + 1];
        if (s.assetId && next) {
          const fadeEnd = end + next.transition.durationSeconds;
          const cover = adapted.sceneLabelCues.find((c) => c.startSeconds <= end && c.endSeconds >= fadeEnd);
          expect(cover?.label, `scene ${s.sceneId} fade`).toBe(s.disclosure!.toUpperCase());
        }
        t = end;
      }
      const cues = [...adapted.sceneLabelCues].sort((a, b) => a.startSeconds - b.startSeconds);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.startSeconds).toBeGreaterThanOrEqual(cues[i - 1]!.endSeconds - 1e-9);
    });
  }
});

describe("buildRenderPlanScenes: a scene's cta is actually painted on screen, not just used for metadata", () => {
  // Regression coverage: scene.cta ("Follow @fillbookhq") previously only selected the closing
  // card's accent caption color and fed pilotMetadata()'s cta/handlePlacement fields -- it was
  // never rendered as its own on-screen text, so a finished video never actually showed the
  // invitation its own metadata claimed to make. Confirmed by grepping a real render's
  // captions.ass for "fillbook"/"follow" before this fix: no match, for any of the nine base
  // pilots. Every pilot's closing scene sets a non-null cta, so this loop covers all of them.
  for (const plan of PILOTS) {
    const closing = plan.scenes[plan.scenes.length - 1]!;
    if (!closing.cta) continue;
    it(`${plan.planId}: the closing scene's caption cue includes its cta text`, async () => {
      const adapted = await buildRenderPlanScenes(withoutCharacters(plan), loadManifest(), mkdtempSync(join(tmpdir(), "cta-")), fakeRunner);
      const closingCue = adapted.captionCues[adapted.captionCues.length - 1];
      expect(closingCue, `${plan.planId} produced no caption cue for its closing scene`).toBeDefined();
      // escapeAssText only touches ASS-special characters ({}\), never letters/digits/@/spaces,
      // so the cta text (plain words and an @handle) survives escaping unchanged.
      expect(closingCue!.text).toContain(closing.cta);
    });
  }
});
