/**
 * Muxes each scene's real narration audio (from generatePilotNarration.ts) into that scene's
 * already-rendered silent video (from previewPlans.ts), then concatenates into
 * preview-with-audio.mp4. Local only: no paid render, no publishing, no network beyond what
 * generatePilotNarration.ts already did to produce the mp3s this reads.
 *
 * Requires previewPlans.ts and generatePilotNarration.ts to have already been run for the same
 * plan (in that order -- previewPlans.ts wipes each plan's output directory, including any
 * narration/ subfolder, so narration must be generated AFTER the silent preview, not before).
 *
 * Audio is padded with silence (never stretched) to each scene's exact video duration, and
 * trimmed if it were ever longer (should not happen given the pacing check in
 * generatePilotNarration.ts's report, but this makes the mux itself safe either way).
 *
 *   npx tsx scripts/video-factory/muxPilotAudio.ts            # all three pilots
 *   npx tsx scripts/video-factory/muxPilotAudio.ts pilot-2    # one pilot
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOTS } from "../../src/shortform/pilots.js";
import type { ScenePlan } from "../../src/shortform/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(here, "..", "..", "out", "preview");

function run(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}):\n${(r.stderr || "").split("\n").slice(-20).join("\n")}`);
}

function muxPlan(plan: ScenePlan): void {
  const dir = join(OUT_ROOT, plan.planId);
  if (!existsSync(join(dir, "scene-plan.json"))) {
    throw new Error(`${dir} has no silent preview yet -- run previewPlans.ts first.`);
  }
  const concat: string[] = [];
  plan.scenes.forEach((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const videoIn = `scene-${n}.mp4`;
    const audioIn = join("narration", scene.sceneId, "voiceover.mp3");
    if (!existsSync(join(dir, audioIn))) {
      throw new Error(`${join(dir, audioIn)} is missing -- run generatePilotNarration.ts after previewPlans.ts for this plan.`);
    }
    const videoOut = `scene-${n}-av.mp4`;
    const d = scene.durationSeconds.toFixed(3);
    // apad extends the mp3 with silence indefinitely; -t <scene duration> then cuts the muxed
    // output to exactly the video's own length, so silence-pad and (if ever needed) trim both
    // happen from the same one clamp instead of two different mechanisms.
    run(
      "ffmpeg",
      [
        "-y",
        "-i",
        videoIn,
        "-i",
        audioIn,
        "-filter_complex",
        "[1:a]apad[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-t",
        d,
        videoOut,
      ],
      dir,
    );
    concat.push(`file '${videoOut}'`);
  });

  writeFileSync(join(dir, "concat-audio.txt"), concat.join("\n") + "\n", "utf8");
  // +faststart moves the moov atom to the front of the file. A plain concat/copy leaves it at the
  // end, which ffmpeg itself tolerates but some desktop players and browsers refuse to open or hang
  // on for a local file:// read (they need the index before they'll start playback).
  run(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", "concat-audio.txt", "-c", "copy", "-movflags", "+faststart", "preview-with-audio.mp4"],
    dir,
  );
  console.log(`  ${join(dir, "preview-with-audio.mp4")}`);
}

function main() {
  const filter = process.argv[2];
  const plans = PILOTS.filter((p) => !filter || p.planId.includes(filter));
  if (plans.length === 0) throw new Error(`No pilot matches "${filter}".`);
  for (const plan of plans) {
    console.log(`${plan.planId}:`);
    muxPlan(plan);
  }
}

main();
