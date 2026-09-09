#!/usr/bin/env node
/**
 * One-shot render script for GitHub Actions.
 * Reads VIDEO_RENDER_ID and CAMPAIGN_ASSET_ID from env, renders the video,
 * uploads to Supabase Storage, sends FCM push notifications, and exits.
 * Called by .github/workflows/video-render.yml — not the polling loop.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../src/lib/supabaseClient.js";
import {
  reserveVideoStorageBytes,
  commitVideoStorageReservation,
  releaseVideoStorageReservation,
} from "../../src/video/videoStorageReservation.js";
import { MAX_VIDEO_STORAGE_BYTES } from "../../src/video/videoRenderEligibility.js";
import { loadFromSupabase, assertApproved } from "../video-factory/loadApprovedScript.js";
import { generateVoiceover, DEFAULT_VOICE } from "../video-factory/voiceover.js";
import { buildCaptionCues, buildAssFile } from "../video-factory/captions.js";
import { buildScenePlan, buildSceneLabelCues } from "../video-factory/scenes.js";
import { renderVideo } from "../video-factory/render.js";
import { copyClipToDir, fetchStockClip, getVideoQuery } from "../video-factory/stockFootage.js";
import { runFfprobeJson, validateOutput } from "../video-factory/validate.js";
import { createProcessRunner, requireExecutable } from "../video-factory/processRunner.js";
import { sendRenderNotification } from "./pushSender.js";
import type { RenderPlan } from "../video-factory/types.js";

const STORAGE_BUCKET = "rendered-videos";
const SILENCE_PAD_SECONDS = 2.5;
const WORK_DIR = process.env.VIDEO_WORKER_WORK_DIR ?? "/tmp/fillbook-video-worker";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRODUCT_DEMO_SRC = join(__dirname, "../video-factory/assets/fillbook-product-demo.mp4");
const PEXELS_CLIP_CACHE = join(WORK_DIR, "_pexels-cache");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const videoRenderId = requireEnv("VIDEO_RENDER_ID");
  const campaignAssetId = requireEnv("CAMPAIGN_ASSET_ID");

  const client = createClient(SUPABASE_URL, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

  const runner = createProcessRunner();
  await requireExecutable(runner, "ffmpeg", ["-version"]);
  await requireExecutable(runner, "ffprobe", ["-version"]);
  await requireExecutable(runner, "uvx", ["--version"]);

  await client
    .from("video_renders")
    .update({ status: "rendering", updated_at: new Date().toISOString() })
    .eq("id", videoRenderId);

  const pkg = await loadFromSupabase(campaignAssetId, client);
  assertApproved(pkg);

  const outDir = join(WORK_DIR, videoRenderId);
  mkdirSync(outDir, { recursive: true });

  const voiceover = await generateVoiceover(pkg.videoScript.script, outDir, runner, DEFAULT_VOICE);
  const captionCues = buildCaptionCues(voiceover.srtCues);
  const totalDurationSeconds = voiceover.durationSeconds + SILENCE_PAD_SECONDS;
  const scenes = buildScenePlan(pkg.videoScript.shotList, totalDurationSeconds);
  const sceneLabelCues = buildSceneLabelCues(scenes);
  const assPath = join(outDir, "captions.ass");
  writeFileSync(assPath, buildAssFile(captionCues, sceneLabelCues), "utf-8");

  // Assign video clip backgrounds to each scene
  const pexelsApiKey = process.env.PEXELS_API_KEY;
  const seed = parseInt(videoRenderId.replace(/-/g, "").slice(0, 8), 16);
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.kind === "product") {
      scene.clipPath = copyClipToDir(PRODUCT_DEMO_SRC, outDir);
    } else if (pexelsApiKey) {
      const query = getVideoQuery(scene.kind, seed + i);
      if (query) {
        const cached = await fetchStockClip(query, scene.durationSeconds, PEXELS_CLIP_CACHE, pexelsApiKey);
        if (cached) scene.clipPath = copyClipToDir(cached, outDir);
      }
    }
  }

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

  const ffprobeResult = await runFfprobeJson(outputPath, runner);
  const fileSizeBytes = statSync(outputPath).size;
  const validation = validateOutput(ffprobeResult, fileSizeBytes, totalDurationSeconds);
  if (!validation.passed) {
    throw new Error(
      `Render validation failed: ${validation.checks
        .filter((c) => !c.passed)
        .map((c) => c.name)
        .join(", ")}`
    );
  }

  const reservation = await reserveVideoStorageBytes(client, videoRenderId, fileSizeBytes, MAX_VIDEO_STORAGE_BYTES);
  if (!reservation.eligible) {
    throw new Error(reservation.reason ?? "storage_cap_reached");
  }

  const storagePath = `${videoRenderId}.mp4`;
  try {
    const fileBuffer = readFileSync(outputPath);
    const { error: uploadError } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, fileBuffer, { contentType: "video/mp4", upsert: false });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    await commitVideoStorageReservation(client, reservation.reservationId as string);
  } catch (err) {
    await releaseVideoStorageReservation(client, reservation.reservationId);
    throw err;
  }

  const durationSeconds = Number(ffprobeResult.format.duration ?? totalDurationSeconds);
  await client
    .from("video_renders")
    .update({ status: "ready", storage_path: storagePath, duration_seconds: durationSeconds, updated_at: new Date().toISOString() })
    .eq("id", videoRenderId);

  // Send FCM push to all non-revoked devices
  const [{ data: devices }, { data: render }] = await Promise.all([
    client.from("device_push_tokens").select("fcm_token").is("revoked_at", null),
    client
      .from("video_renders")
      .select("campaign_assets(campaigns(thesis))")
      .eq("id", videoRenderId)
      .maybeSingle(),
  ]);

  const campaignTitle =
    (render as { campaign_assets?: { campaigns?: { thesis?: string } } } | null)
      ?.campaign_assets?.campaigns?.thesis ?? "Your video";

  for (const device of (devices ?? []) as Array<{ fcm_token: string }>) {
    await sendRenderNotification(device.fcm_token, { videoRenderId, kind: "ready", campaignTitle });
  }

  console.log(`[render-single] done: ${videoRenderId} → ${storagePath}`);
}

main().catch((err) => {
  console.error("[render-single] fatal:", (err as Error).message ?? err);
  process.exitCode = 1;
});
