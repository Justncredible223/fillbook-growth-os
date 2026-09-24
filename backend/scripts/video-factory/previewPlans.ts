/**
 * Local, free preview of the short-form pilot scene plans. NO paid render, NO TTS, NO network, NO
 * publishing: only local ffmpeg on bundled screenshots. Writes to backend/out/preview/<plan>/ (gitignored).
 *
 *   npx tsx scripts/video-factory/previewPlans.ts            # all three pilots
 *   npx tsx scripts/video-factory/previewPlans.ts pilot-2    # one pilot (substring of the plan id)
 *
 * For each pilot it writes: contact-sheet.png, safe-area-sheet.png, preview.mp4 (silent), timing-report.md,
 * claims-report.md, privacy-report.md, crop-safe-area-report.md, SUMMARY.md, plan-validation.json and the
 * platform metadata. A plan with a missing source asset still gets a preview, with a loud MISSING ASSET card
 * where the screenshot would be. A structurally valid preview is not a visually approved video.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePublishedMetadata, serializeMetadata } from "../../src/shortform/metadata.js";
import { PILOTS, pilotMetadata } from "../../src/shortform/pilots.js";
import { buildFilterComplex, buildSafeAreaOverlay, buildSceneAss, placeMedia } from "../../src/shortform/previewRender.js";
import { layoutBoxes } from "../../src/shortform/layout.js";
import { buildClaimsReport, buildCropReport, buildPlanSummary, buildPrivacyReport, buildTimingReport } from "../../src/shortform/reports.js";
import { ASSETS_DIR, loadManifest, validateScenePlan } from "../../src/shortform/scenePlan.js";
import type { Platform, ScenePlan } from "../../src/shortform/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = resolve(here, "..", "..", "out", "preview");
const FONT = join(ASSETS_DIR, "fonts", "Poppins-ExtraBold.ttf");
const FPS = 30;

function run(cmd: string, args: string[], cwd: string): void {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} failed (${r.status}):\n${(r.stderr || "").split("\n").slice(-12).join("\n")}`);
}

function renderPlan(plan: ScenePlan): { dir: string; ok: boolean; blocked: boolean; files: string[] } {
  const manifest = loadManifest();
  const validation = validateScenePlan(plan, manifest, { checkFiles: true });
  const dir = join(OUT_ROOT, plan.planId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "fonts"), { recursive: true });
  copyFileSync(FONT, join(dir, "fonts", "Poppins-ExtraBold.ttf"));
  const files: string[] = [];
  const write = (name: string, body: string) => {
    writeFileSync(join(dir, name), body, "utf8");
    files.push(join(dir, name));
  };

  write("SUMMARY.md", buildPlanSummary(plan, validation));
  write("timing-report.md", buildTimingReport(plan));
  write("claims-report.md", buildClaimsReport(plan, manifest, validation));
  write("privacy-report.md", buildPrivacyReport(plan, manifest, validation));
  write("crop-safe-area-report.md", buildCropReport(plan, manifest, validation));
  write("plan-validation.json", JSON.stringify(validation, null, 2));
  write("scene-plan.json", JSON.stringify(plan, null, 2));
  for (const platform of plan.platforms) {
    const meta = pilotMetadata(plan, platform as Platform);
    write(`metadata-${platform}.json`, serializeMetadata(meta));
    write(`metadata-${platform}-issues.json`, JSON.stringify(validatePublishedMetadata(meta), null, 2));
  }

  const watermark = validation.ok ? "PREVIEW - NOT VISUALLY APPROVED" : "PREVIEW - NOT FOR PUBLISHING - PLAN HAS ERRORS";
  const media = layoutBoxes("tiktok").media;
  const stillNames: string[] = [];
  const debugNames: string[] = [];
  const concat: string[] = [];

  plan.scenes.forEach((scene, i) => {
    const n = String(i + 1).padStart(2, "0");
    const asset = scene.assetId ? manifest.assets.find((a) => a.id === scene.assetId) : undefined;
    const missing = Boolean(scene.assetId && !asset);
    const placement = asset ? placeMedia(scene) : null;
    const assName = `scene-${n}.ass`;
    writeFileSync(
      join(dir, assName),
      buildSceneAss(scene, { label: `S${i + 1}  ${scene.durationSeconds.toFixed(1)}s  ${scene.sceneId}`, missingAssetId: missing ? scene.assetId : null, watermark }),
      "utf8",
    );
    const filter = buildFilterComplex(placement, { assFile: assName, fontsDir: "fonts", placeholderBox: missing ? media : null });
    const d = scene.durationSeconds.toFixed(3);
    const args = ["-y", "-f", "lavfi", "-i", `color=c=0x05070a:s=1080x1920:r=${FPS}:d=${d}`];
    if (placement && asset) {
      if (asset.kind === "screen_recording") {
        // Real captured motion, trimmed to this scene's declared range and
        // played at its declared speed (1x here for every current pilot
        // scene) -- NEVER -stream_loop or a static frame hold to stretch a
        // short clip to fill scene.durationSeconds. validateMotionTiming
        // (layout.ts) already refuses to let a plan reach this point if the
        // range is shorter than the scene needs, so trimming here is safe
        // by construction, not a runtime guess.
        const range = scene.clipTimeRangeSeconds!; // validated non-null for a screen_recording scene
        if ((scene.playbackSpeed ?? 1) !== 1) {
          throw new Error(
            `${scene.sceneId}: playbackSpeed !== 1 is declared in the type but not yet implemented in this renderer (would need a setpts filter stage) -- ` +
              `no current pilot scene uses it, so this is reported rather than silently ignored.`,
          );
        }
        args.push("-ss", range.start.toFixed(3), "-to", range.end.toFixed(3), "-i", join(ASSETS_DIR, asset.file));
      } else {
        args.push("-loop", "1", "-t", d, "-i", join(ASSETS_DIR, asset.file));
      }
    }
    args.push("-filter_complex", filter, "-map", "[v]", "-t", d, "-r", String(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", `scene-${n}.mp4`);
    run("ffmpeg", args, dir);
    run("ffmpeg", ["-y", "-ss", "0.2", "-i", `scene-${n}.mp4`, "-frames:v", "1", `still-${n}.png`], dir);
    run("ffmpeg", ["-y", "-i", `still-${n}.png`, "-vf", buildSafeAreaOverlay(), "-frames:v", "1", `debug-${n}.png`], dir);
    stillNames.push(`still-${n}.png`);
    debugNames.push(`debug-${n}.png`);
    concat.push(`file 'scene-${n}.mp4'`);
  });

  writeFileSync(join(dir, "concat.txt"), concat.join("\n") + "\n", "utf8");
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "preview.mp4"], dir);
  files.push(join(dir, "preview.mp4"));

  const cols = Math.min(plan.scenes.length, 4);
  const rows = Math.ceil(plan.scenes.length / cols);
  const sheet = (pattern: string, out: string) => {
    run("ffmpeg", ["-y", "-framerate", "1", "-i", pattern, "-vf", `scale=270:480,tile=${cols}x${rows}:padding=10:color=0x111111`, "-frames:v", "1", out], dir);
    files.push(join(dir, out));
  };
  sheet("still-%02d.png", "contact-sheet.png");
  sheet("debug-%02d.png", "safe-area-sheet.png");

  for (const name of [...stillNames, ...debugNames]) if (existsSync(join(dir, name))) files.push(join(dir, name));
  return { dir, ok: validation.ok, blocked: validation.blockedByMissingAssets, files };
}

function main() {
  const filter = process.argv[2];
  const plans = PILOTS.filter((p) => !filter || p.planId.includes(filter));
  if (plans.length === 0) throw new Error(`No pilot matches "${filter}".`);
  mkdirSync(OUT_ROOT, { recursive: true });
  const index: string[] = ["# Pilot previews", "", "Local previews only. Nothing was rendered with a paid service, no voice was generated, nothing was published.", ""];
  for (const plan of plans) {
    const r = renderPlan(plan);
    const status = r.blocked ? "BLOCKED (missing source asset)" : r.ok ? "structurally valid, NOT visually approved" : "has validation errors";
    console.log(`${plan.planId}: ${status}\n  ${r.dir}`);
    index.push(`## ${plan.title}`, `- Status: ${status}`, `- Folder: ${r.dir}`, `- Contact sheet: ${join(r.dir, "contact-sheet.png")}`, `- Preview: ${join(r.dir, "preview.mp4")}`, "");
  }
  writeFileSync(join(OUT_ROOT, "INDEX.md"), index.join("\n"), "utf8");
  console.log(`Index: ${join(OUT_ROOT, "INDEX.md")}`);
}

main();
