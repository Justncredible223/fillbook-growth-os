import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRenderPlanScenes } from "../../scripts/video-factory/scenePlanAdapter.js";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner.js";
import { loadManifest } from "../../src/shortform/scenePlan.js";
import { PILOTS } from "../../src/shortform/pilots.js";

const fakeRunner: ProcessRunner = {
  async run(_cmd, args) {
    writeFileSync(args[args.length - 1]!, "");
    return { stdout: "", stderr: "", exitCode: 0 };
  },
};

describe("buildRenderPlanScenes label cues across fades", () => {
  for (const plan of PILOTS) {
    it(`${plan.planId}: evidence stays under its own label through the outgoing fade, with no overlapping labels`, async () => {
      const adapted = await buildRenderPlanScenes(plan, loadManifest(), mkdtempSync(join(tmpdir(), "labels-")), fakeRunner);
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
