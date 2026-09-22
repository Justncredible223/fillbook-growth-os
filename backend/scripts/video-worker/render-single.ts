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
import { buildCaptionCues, buildAssFile, getHookMidpointSeconds, mergeBrandNameWordCues } from "../video-factory/captions.js";
import { buildScenePlan, buildSceneLabelCues, selectBestThumbnailSeconds } from "../video-factory/scenes.js";
import { renderVideo, extractThumbnail } from "../video-factory/render.js";
import { assignUiScreens, assignHookFallbackScreen, copyUiScreenToDir } from "../video-factory/uiScreens.js";
import { pickMusic } from "../video-factory/music.js";
import { copyClipToDir, fetchStockClip, getSceneQuery, getVideoQuery, type StockFootageCredentials } from "../video-factory/stockFootage.js";
import { inspectClip } from "../video-factory/clipQuality.js";
import { runFfprobeJson, validateOutput } from "../video-factory/validate.js";
import { createProcessRunner, requireExecutable } from "../video-factory/processRunner.js";
import { sendRenderNotification } from "./pushSender.js";
import type { RenderPlan } from "../video-factory/types.js";

const STORAGE_BUCKET = "rendered-videos";
// Just enough tail that TTS/AAC never clips the last word. No brand card or
// dead air after the voice: the script's last line flows back into the hook,
// so the video loops cleanly (rewatches are a strong TikTok ranking signal).
const SILENCE_PAD_SECONDS = 0.3;
const WORK_DIR = process.env.VIDEO_WORKER_WORK_DIR ?? "/tmp/fillbook-video-worker";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRODUCT_DEMO_SRC = join(__dirname, "../video-factory/assets/fillbook-product-demo.mp4");
// Directory name kept generic (not "_shutterstock-cache") so a future
// provider swap doesn't orphan an already-downloaded clip library.
const STOCK_CLIP_CACHE = join(WORK_DIR, "_stock-footage-cache");

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
  await requireExecutable(runner, "python3", ["--version"]);

  await client
    .from("video_renders")
    .update({ status: "rendering", updated_at: new Date().toISOString() })
    .eq("id", videoRenderId);

  const pkg = await loadFromSupabase(campaignAssetId, client);
  assertApproved(pkg);

  const outDir = join(WORK_DIR, videoRenderId);
  mkdirSync(outDir, { recursive: true });

  const voiceover = await generateVoiceover(pkg.videoScript.script, outDir, runner, DEFAULT_VOICE);
  const totalDurationSeconds = voiceover.durationSeconds + SILENCE_PAD_SECONDS;
  const wordCues = mergeBrandNameWordCues(voiceover.wordCues);
  const captionCues = buildCaptionCues(wordCues);
  const scenes = buildScenePlan(pkg.videoScript.shotList, totalDurationSeconds, wordCues);
  const sceneLabelCues = buildSceneLabelCues(scenes);
  const assPath = join(outDir, "captions.ass");
  writeFileSync(assPath, buildAssFile(captionCues, sceneLabelCues), "utf-8");

  // Assign video clip backgrounds to each scene -- searches Pexels and
  // Pixabay together (either key may be unset; fetchStockClip just skips
  // whichever provider has none), so the effective clip pool is the union
  // of both free libraries rather than one at a time.
  const stockCredentials: StockFootageCredentials = {
    pexelsApiKey: process.env.PEXELS_API_KEY ?? null,
    pixabayApiKey: process.env.PIXABAY_API_KEY ?? null,
  };
  const hasAnyStockProvider = Boolean(stockCredentials.pexelsApiKey || stockCredentials.pixabayApiKey);
  console.log(
    `[render-single] stock footage providers: pexels=${Boolean(stockCredentials.pexelsApiKey)} pixabay=${Boolean(stockCredentials.pixabayApiKey)}`,
  );
  const seed = parseInt(videoRenderId.replace(/-/g, "").slice(0, 8), 16);
  // Product scenes get a real Fillbook app screenshot (a slow vertical pan)
  // instead of stock B-roll or a flat card. Copying to outDir happens once,
  // below, after the hook fallback (next) has had its own chance to assign
  // an imagePath too -- otherwise a hook-fallback screen would be left
  // pointing at the bundled assets path instead of this render's own copy.
  assignUiScreens(scenes, seed);
  console.log(`[render-single] UI screenshots: ${scenes.filter((s) => s.imagePath).length}/${scenes.length} scenes are real app screens`);

  let scenesWithClip = 0;
  // Every stock clip is looked at before it is used: the relevance filter only reads a clip's title and
  // tags, so blank-white and green-screen clips (both reached a real render on 2026-09-20) used to get through.
  const clipOptions = {
    qualityCheck: (clipPath: string) => inspectClip(clipPath, runner, outDir),
    onRejected: (clipId: string, reason: string) => console.log(`[render-single] rejected stock clip ${clipId}: ${reason}`),
  };
  for (const [i, scene] of scenes.entries()) {
    if (scene.imagePath) continue;
    if (hasAnyStockProvider) {
      // Prefer footage that matches what is being said over this scene; if that search
      // comes back empty, fall back to the scene kind's generic rotation before giving up.
      const query = getSceneQuery(scene, seed + i);
      if (query) {
        let cached = await fetchStockClip(query, scene.durationSeconds, STOCK_CLIP_CACHE, stockCredentials, clipOptions);
        if (!cached) {
          const fallbackQuery = getVideoQuery(scene.kind, seed + i);
          if (fallbackQuery && fallbackQuery !== query) {
            cached = await fetchStockClip(fallbackQuery, scene.durationSeconds, STOCK_CLIP_CACHE, stockCredentials, clipOptions);
          }
        }
        if (cached) {
          scene.clipPath = copyClipToDir(cached, outDir);
          scenesWithClip++;
          console.log(`[render-single] scene ${i} (${scene.kind}): real footage for query "${query}"`);
        } else {
          // fetchStockClip swallows the real reason (no matching results,
          // relevance filter rejected everything, or a network/API
          // failure) by design -- see its own doc comment ("no clip is
          // strictly better than an off-topic clip"). This is deliberately
          // the one place that surfaces WHICH scenes fell back, since that
          // was previously invisible in every render log.
          console.log(`[render-single] scene ${i} (${scene.kind}): no clip found for query "${query}" -- falling back to solid color`);
        }
      }
    }
  }
  console.log(`[render-single] stock footage: ${scenesWithClip}/${scenes.length} scenes got real footage`);

  // Retention-critical: the hook scene (the first ~1-3s, when a viewer decides whether to stay)
  // must never fall through to a flat color card just because stock footage wasn't configured or
  // no relevant clip was found. This only fills a hook scene that still has neither imagePath nor
  // clipPath at this point -- see assignHookFallbackScreen's own doc comment for why.
  assignHookFallbackScreen(scenes, seed);
  for (const scene of scenes) {
    if (scene.imagePath) scene.imagePath = copyUiScreenToDir(scene.imagePath, outDir);
  }
  console.log(`[render-single] hook scene visual: ${scenes[0]?.imagePath ? "screenshot" : scenes[0]?.clipPath ? "stock footage" : "FLAT COLOR CARD (retention risk)"}`);

  const music = await pickMusic(seed, totalDurationSeconds, runner);
  if (music) console.log(`[render-single] music: ${music.file.split(/[\/]/).pop()} from ${music.startSeconds}s`);

  const outputPath = join(outDir, "final.mp4");
  const plan: RenderPlan = {
    scenes,
    totalDurationSeconds,
    voiceoverPath: voiceover.mp3Path,
    assPath,
    outputPath,
    silencePadSeconds: SILENCE_PAD_SECONDS,
    musicFile: music?.file,
    musicStartSeconds: music?.startSeconds,
  };
  await renderVideo(plan, runner);

  const ffprobeResult = await runFfprobeJson(outputPath, runner);
  const fileSizeBytes = statSync(outputPath).size;
  // Logged plainly (not just on failure) so a future storage-upload
  // rejection -- e.g. "The object exceeded the maximum allowed size", a
  // real production failure this fixed 2026-09-17 by lowering CRF and
  // adding a bitrate cap -- has an actual number in the run log to
  // diagnose against, instead of only the opaque Supabase error message.
  console.log(`[render-single] output size: ${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB, duration: ${totalDurationSeconds.toFixed(1)}s`);
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

  // Best-effort: a downloadable thumbnail is a nice-to-have on top of an
  // already-successful video, not a correctness requirement -- a failure
  // here (e.g. the selected frame landing on a corrupt frame) never fails
  // the whole render, it just leaves thumbnail_path null for this row.
  let thumbnailPath: string | null = null;
  try {
    // Prefers the midpoint of a scene with real stock footage (the "best
    // shot") over always grabbing the Hook's on-screen window, which
    // frequently landed on a flat brand-color card when no stock clip had
    // loaded for that early scene -- see selectBestThumbnailSeconds's own
    // doc comment. Falls back to the old Hook-midpoint behavior only when
    // every scene rendered as a flat color card.
    const hookMidpoint = getHookMidpointSeconds(captionCues);
    const thumbnailSeconds = selectBestThumbnailSeconds(scenes, hookMidpoint) ?? 1;
    const thumbnailLocalPath = join(outDir, "thumbnail.jpg");
    await extractThumbnail(outputPath, thumbnailSeconds, thumbnailLocalPath, runner);
    const candidatePath = `${videoRenderId}-thumbnail.jpg`;
    const { error: thumbUploadError } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(candidatePath, readFileSync(thumbnailLocalPath), { contentType: "image/jpeg", upsert: false });
    if (thumbUploadError) throw new Error(`Thumbnail upload failed: ${thumbUploadError.message}`);
    thumbnailPath = candidatePath;
  } catch (err) {
    console.error("[render-single] thumbnail generation failed (non-fatal):", (err as Error).message ?? err);
  }

  const durationSeconds = Number(ffprobeResult.format.duration ?? totalDurationSeconds);
  await client
    .from("video_renders")
    // error: null clears any stale message from a prior failed attempt on
    // the same render row (render-single doesn't reuse rows, but belt-and-
    // suspenders against a future retry path).
    .update({
      status: "ready",
      storage_path: storagePath,
      thumbnail_path: thumbnailPath,
      duration_seconds: durationSeconds,
      error: null,
      updated_at: new Date().toISOString(),
    })
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

main().catch(async (err) => {
  const message = (err as Error).message ?? String(err);
  console.error("[render-single] fatal:", message);
  // Write the failure back to the DB so the app shows the real error instead
  // of leaving the render stuck in "rendering" forever (the old Oracle VM
  // worker did this; this script previously did not).
  try {
    const videoRenderId = process.env.VIDEO_RENDER_ID;
    if (videoRenderId) {
      const { createClient } = await import("@supabase/supabase-js");
      const { SUPABASE_URL } = await import("../../src/lib/supabaseClient.js");
      const client = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
        auth: { persistSession: false },
      });
      await client
        .from("video_renders")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", videoRenderId);
    }
  } catch (dbErr) {
    console.error("[render-single] also failed to write failure to DB:", (dbErr as Error).message ?? dbErr);
  }
  process.exitCode = 1;
});
