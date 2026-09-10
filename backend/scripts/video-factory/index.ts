#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessRunner, requireExecutable, type ProcessRunner } from "./processRunner.js";
import {
  SUPABASE_URL,
  assertApproved,
  createLocalSupabaseClient,
  loadFromFile,
  loadFromSupabase,
} from "./loadApprovedScript.js";
import { generateVoiceover, DEFAULT_VOICE } from "./voiceover.js";
import { buildCaptionCues, buildAssFile } from "./captions.js";
import { buildScenePlan, buildSceneLabelCues } from "./scenes.js";
import { renderVideo } from "./render.js";
import { runFfprobeJson, validateOutput } from "./validate.js";
import { VideoFactoryError, type RenderPlan, type RenderReport, type VideoScriptPackage } from "./types.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
/** backend/scripts/video-factory -> backend/ */
const BACKEND_ROOT = resolve(SCRIPT_DIR, "..", "..");
const SILENCE_PAD_SECONDS = 2.5;

/** Minimal .env.local loader -- Vercel injects env vars at runtime, but a local CLI has no such thing. Never overwrites an already-set var (e.g. from the real shell env). */
function loadDotEnvLocal(): void {
  const envPath = join(BACKEND_ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

interface CliArgs {
  draftId: string | null;
  inputPath: string | null;
  voice: string;
  outDirOverride: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  let draftId: string | null = null;
  let inputPath: string | null = null;
  let voice = DEFAULT_VOICE;
  let outDirOverride: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      inputPath = argv[++i] ?? null;
    } else if (arg === "--voice") {
      voice = argv[++i] ?? voice;
    } else if (arg === "--out-dir") {
      outDirOverride = argv[++i] ?? null;
    } else if (!arg?.startsWith("--") && !draftId) {
      draftId = arg ?? null;
    }
  }

  if (!draftId && !inputPath) {
    throw new VideoFactoryError(
      "Usage: npm run video:render -- <draft-id>\n" +
        "   or: npm run video:render -- --input path/to/approved-video-package.json\n" +
        "Optional: --voice <edge-tts voice> --out-dir <directory>",
    );
  }
  return { draftId, inputPath, voice, outDirOverride };
}

async function loadPackage(args: CliArgs): Promise<VideoScriptPackage> {
  if (args.inputPath) {
    return loadFromFile(resolve(args.inputPath));
  }
  loadDotEnvLocal();
  const client = createLocalSupabaseClient(SUPABASE_URL);
  return loadFromSupabase(args.draftId as string, client);
}

async function checkPrerequisites(runner: ProcessRunner): Promise<void> {
  await requireExecutable(runner, "ffmpeg", ["-version"]);
  await requireExecutable(runner, "ffprobe", ["-version"]);
  await requireExecutable(runner, "python3", ["--version"]);
}

function printSummary(report: RenderReport): void {
  console.log("");
  console.log("VIDEO FACTORY COMPLETE");
  console.log("");
  console.log(`Draft: ${report.draftId}`);
  console.log(`Title/hook: ${report.hook}`);
  console.log(`Duration: ${report.durationSeconds.toFixed(1)} sec`);
  console.log(`Resolution: ${report.resolution}`);
  console.log(`Video codec: ${report.videoCodec}`);
  console.log(`Audio codec: ${report.audioCodec}`);
  console.log(`Validation: ${report.validation.passed ? "PASS" : "FAIL"}`);
  for (const check of report.validation.checks) {
    console.log(`  ${check.passed ? "✓" : "✗"} ${check.name} -- ${check.detail}`);
  }
  console.log("");
  console.log("Output:");
  console.log(report.outputPath);
  console.log("");
  console.log("TikTok caption:");
  console.log(report.tiktokCaption);
  console.log("");
  console.log("Hashtags:");
  console.log(report.hashtags.map((h) => `#${h}`).join(" "));
  console.log("");
  console.log("Uploading to TikTok is still a manual step -- this tool never publishes anything.");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runner = createProcessRunner();

  console.log("Checking prerequisites (ffmpeg, ffprobe, python3)...");
  await checkPrerequisites(runner);

  console.log("Loading production package...");
  const pkg = await loadPackage(args);
  assertApproved(pkg);
  console.log(`Loaded "${pkg.campaignTitle}" (${pkg.platform}/${pkg.assetType}), approved by ${pkg.approvedBy ?? "unknown"} at ${pkg.approvedAt}.`);

  const outDir = args.outDirOverride
    ? resolve(args.outDirOverride)
    : join(BACKEND_ROOT, "output", "video-factory", pkg.draftId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");

  console.log("Generating narration (edge-tts)...");
  const voiceover = await generateVoiceover(pkg.videoScript.script, outDir, runner, args.voice);
  console.log(`Narration duration: ${voiceover.durationSeconds.toFixed(1)}s.`);

  console.log("Building captions...");
  const captionCues = buildCaptionCues(voiceover.wordCues);
  const totalDurationSeconds = voiceover.durationSeconds + SILENCE_PAD_SECONDS;
  const scenes = buildScenePlan(pkg.videoScript.shotList, totalDurationSeconds);
  const sceneLabelCues = buildSceneLabelCues(scenes);
  const assContent = buildAssFile(captionCues, sceneLabelCues);
  const assPath = join(outDir, "captions.ass");
  writeFileSync(assPath, assContent, "utf-8");

  console.log("Rendering (ffmpeg)...");
  const outputPath = join(outDir, "final.mp4");
  const plan: RenderPlan = {
    scenes,
    totalDurationSeconds,
    voiceoverPath: voiceover.mp3Path,
    assPath,
    outputPath,
    silencePadSeconds: SILENCE_PAD_SECONDS,
  };
  await renderVideo(plan, runner);

  console.log("Validating output (ffprobe)...");
  const ffprobeResult = await runFfprobeJson(outputPath, runner);
  const fileSizeBytes = statSync(outputPath).size;
  const validation = validateOutput(ffprobeResult, fileSizeBytes, totalDurationSeconds);

  const videoStream = ffprobeResult.streams.find((s) => s.codec_type === "video");
  const audioStream = ffprobeResult.streams.find((s) => s.codec_type === "audio");
  const report: RenderReport = {
    draftId: pkg.draftId,
    campaignTitle: pkg.campaignTitle,
    hook: pkg.videoScript.hook,
    tiktokCaption: pkg.videoScript.tiktokCaption,
    hashtags: pkg.videoScript.hashtags,
    durationSeconds: Number(ffprobeResult.format.duration ?? totalDurationSeconds),
    resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : "unknown",
    videoCodec: videoStream?.codec_name ?? "unknown",
    audioCodec: audioStream?.codec_name ?? "unknown",
    validation,
    outputPath,
    renderedAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, "render-report.json"), JSON.stringify(report, null, 2), "utf-8");

  printSummary(report);

  if (!validation.passed) {
    console.error("\nValidation FAILED -- see checks above. Not treating this render as usable.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  if (err instanceof VideoFactoryError) {
    console.error(`\nVideo Factory error: ${err.message}`);
  } else {
    console.error("\nUnexpected error:");
    console.error(err);
  }
  process.exitCode = 1;
});
