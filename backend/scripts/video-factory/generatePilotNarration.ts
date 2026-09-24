/**
 * Generates real narration audio for the three short-form pilots, scene by scene, using the
 * existing free edge-tts pipeline (voiceover.ts / edge_tts_words.py). No paid service, no video
 * render, no publishing -- this only produces .mp3 + word-timing files per scene and a report
 * comparing each scene's AUTHORED durationSeconds (a guess, used for the silent preview) against
 * the REAL spoken duration edge-tts actually produces, since the two are not the same thing.
 *
 * This does NOT touch preview.mp4 or any other rendered file -- muxing this audio into the video
 * (and reconciling scene durations with real speech length) is a separate, later step.
 *
 *   npx tsx scripts/video-factory/generatePilotNarration.ts            # all three pilots
 *   npx tsx scripts/video-factory/generatePilotNarration.ts pilot-2    # one pilot
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessRunner, requireExecutable } from "./processRunner.js";
import { generateVoiceover, DEFAULT_VOICE, DEFAULT_RATE } from "./voiceover.js";
import { PILOTS } from "../../src/shortform/pilots.js";
import type { ScenePlan } from "../../src/shortform/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(here, "..", "..", "out", "preview");

interface SceneNarrationResult {
  sceneId: string;
  narration: string;
  authoredSeconds: number;
  actualSeconds: number;
  driftSeconds: number;
  mp3Path: string;
}

async function narrateplan(plan: ScenePlan, runner: Awaited<ReturnType<typeof createProcessRunner>>): Promise<SceneNarrationResult[]> {
  const dir = join(OUT_ROOT, plan.planId, "narration");
  mkdirSync(dir, { recursive: true });
  const results: SceneNarrationResult[] = [];
  for (const scene of plan.scenes) {
    const sceneDir = join(dir, scene.sceneId);
    mkdirSync(sceneDir, { recursive: true });
    const voiceover = await generateVoiceover(scene.narration, sceneDir, runner, DEFAULT_VOICE, DEFAULT_RATE);
    results.push({
      sceneId: scene.sceneId,
      narration: scene.narration,
      authoredSeconds: scene.durationSeconds,
      actualSeconds: voiceover.durationSeconds,
      driftSeconds: voiceover.durationSeconds - scene.durationSeconds,
      mp3Path: voiceover.mp3Path,
    });
    console.log(`  ${scene.sceneId}: authored ${scene.durationSeconds.toFixed(1)}s, real speech ${voiceover.durationSeconds.toFixed(1)}s (${voiceover.durationSeconds - scene.durationSeconds >= 0 ? "+" : ""}${(voiceover.durationSeconds - scene.durationSeconds).toFixed(1)}s)`);
  }
  return results;
}

function buildReport(plan: ScenePlan, results: SceneNarrationResult[]): string {
  const lines = [
    `# Real narration audio: ${plan.title}`,
    "",
    "Generated with the free edge-tts voice (no API key, no cost). This does NOT change preview.mp4 --",
    "scene video durations were authored by hand and have not been reconciled with real speech length yet.",
    "",
    "| Scene | Authored (s) | Real speech (s) | Drift (s) | Flag |",
    "| --- | --- | --- | --- | --- |",
  ];
  let totalAuthored = 0;
  let totalActual = 0;
  for (const r of results) {
    totalAuthored += r.authoredSeconds;
    totalActual += r.actualSeconds;
    const flag = Math.abs(r.driftSeconds) > 1 ? "**drift > 1s**" : r.driftSeconds > 0 ? "runs long" : "ok";
    lines.push(`| ${r.sceneId} | ${r.authoredSeconds.toFixed(1)} | ${r.actualSeconds.toFixed(1)} | ${r.driftSeconds >= 0 ? "+" : ""}${r.driftSeconds.toFixed(1)} | ${flag} |`);
  }
  lines.push("", `**Total: authored ${totalAuthored.toFixed(1)}s vs real speech ${totalActual.toFixed(1)}s (${totalActual - totalAuthored >= 0 ? "+" : ""}${(totalActual - totalAuthored).toFixed(1)}s).**`, "");
  lines.push("Scene video lengths were NOT changed to match. Before muxing this audio into the actual preview, each scene's video duration should be reconciled with its real speech length (either stretched to match, or the narration/pace rewritten to fit).");
  return lines.join("\n");
}

async function main() {
  const filter = process.argv[2];
  const plans = PILOTS.filter((p) => !filter || p.planId.includes(filter));
  if (plans.length === 0) throw new Error(`No pilot matches "${filter}".`);

  const runner = createProcessRunner();
  console.log("Checking prerequisites (python3, ffprobe)...");
  await requireExecutable(runner, "python3", ["--version"]);
  await requireExecutable(runner, "ffprobe", ["-version"]);

  for (const plan of plans) {
    console.log(`\n${plan.planId}:`);
    const results = await narrateplan(plan, runner);
    const reportPath = join(OUT_ROOT, plan.planId, "narration-report.md");
    writeFileSync(reportPath, buildReport(plan, results), "utf8");
    console.log(`  report: ${reportPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
