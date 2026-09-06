#!/usr/bin/env node
/**
 * Standalone render-worker process -- runs on the dedicated Contabo VPS
 * (NOT part of the Vercel deployment; see the implementation plan's
 * isolation section), polling the same `system_jobs` queue every other
 * job type uses, but claiming only `job_type='render_video'`. Wraps the
 * existing, unmodified video-factory CLI modules (scripts/video-factory/)
 * rather than reimplementing rendering -- see docs/VIDEO_FACTORY.md.
 *
 * Two independent polling loops run concurrently in this one process:
 * `renderLoop` (claims and processes render jobs) and `notificationLoop`
 * (claims and sends the FCM outbox rows those renders produce). Each
 * loop's own try/catch means a bug in one never stops the other.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "../../src/lib/supabaseClient.js";
import { SupabaseJobQueueRepository } from "../../src/jobs/supabaseJobQueueRepository.js";
import { decideRetry } from "../../src/jobs/backoff.js";
import {
  reserveVideoStorageBytes,
  commitVideoStorageReservation,
  releaseVideoStorageReservation,
} from "../../src/video/videoStorageReservation.js";
import { queueVideoRenderNotification, claimVideoRenderNotification, markVideoRenderNotificationSent, recordVideoRenderNotificationFailure } from "../../src/video/videoRenderNotifications.js";
import { MAX_VIDEO_STORAGE_BYTES } from "../../src/video/videoRenderEligibility.js";
import { loadFromSupabase, assertApproved } from "../video-factory/loadApprovedScript.js";
import { generateVoiceover, DEFAULT_VOICE } from "../video-factory/voiceover.js";
import { buildCaptionCues, buildAssFile } from "../video-factory/captions.js";
import { buildScenePlan, buildSceneLabelCues } from "../video-factory/scenes.js";
import { renderVideo } from "../video-factory/render.js";
import { runFfprobeJson, validateOutput } from "../video-factory/validate.js";
import { createProcessRunner, requireExecutable } from "../video-factory/processRunner.js";
import { sendRenderNotification } from "./pushSender.js";
import type { RenderPlan } from "../video-factory/types.js";

const STORAGE_BUCKET = "rendered-videos";
const SILENCE_PAD_SECONDS = 2.5;
const POLL_INTERVAL_MS = 15_000;
const NOTIFICATION_POLL_INTERVAL_MS = 10_000;
const WORK_DIR = process.env.VIDEO_WORKER_WORK_DIR ?? "/var/lib/fillbook-video-worker/renders";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the environment.`);
  return value;
}

function buildClient() {
  return createClient(SUPABASE_URL, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

interface RenderJobPayload {
  campaignAssetId: string;
  videoRenderId: string;
}

/** Runs the full render pipeline (identical steps to video-factory/index.ts's main()) for one already-claimed job, writing output under WORK_DIR/<videoRenderId>/. */
async function renderOne(client: ReturnType<typeof buildClient>, payload: RenderJobPayload): Promise<void> {
  const runner = createProcessRunner();
  await requireExecutable(runner, "ffmpeg", ["-version"]);
  await requireExecutable(runner, "ffprobe", ["-version"]);
  await requireExecutable(runner, "uvx", ["--version"]);

  await client.from("video_renders").update({ status: "rendering", updated_at: new Date().toISOString() }).eq("id", payload.videoRenderId);

  const pkg = await loadFromSupabase(payload.campaignAssetId, client);
  assertApproved(pkg);

  const outDir = join(WORK_DIR, payload.videoRenderId);
  mkdirSync(outDir, { recursive: true });

  const voiceover = await generateVoiceover(pkg.videoScript.script, outDir, runner, DEFAULT_VOICE);
  const captionCues = buildCaptionCues(voiceover.srtCues);
  const totalDurationSeconds = voiceover.durationSeconds + SILENCE_PAD_SECONDS;
  const scenes = buildScenePlan(pkg.videoScript.shotList, totalDurationSeconds);
  const sceneLabelCues = buildSceneLabelCues(scenes);
  const assPath = join(outDir, "captions.ass");
  writeFileSync(assPath, buildAssFile(captionCues, sceneLabelCues), "utf-8");

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
    throw new Error(`Render validation failed: ${validation.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`);
  }

  // Reserve BEFORE uploading -- never treat a mere reservation as
  // permanent usage (see videoStorageReservation.ts's doc comment).
  const reservation = await reserveVideoStorageBytes(client, payload.videoRenderId, fileSizeBytes, MAX_VIDEO_STORAGE_BYTES);
  if (!reservation.eligible) {
    throw new Error(reservation.reason ?? "storage_cap_reached");
  }

  const storagePath = `${payload.videoRenderId}.mp4`;
  try {
    const fileBuffer = readFileSync(outputPath);
    const { error: uploadError } = await client.storage.from(STORAGE_BUCKET).upload(storagePath, fileBuffer, {
      contentType: "video/mp4",
      upsert: false,
    });
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
    .eq("id", payload.videoRenderId);

  await queueReadyOrFailedNotifications(client, payload.videoRenderId, "ready");
}

async function queueReadyOrFailedNotifications(client: ReturnType<typeof buildClient>, videoRenderId: string, kind: "ready" | "failed"): Promise<void> {
  const { data: devices } = await client.from("device_push_tokens").select("id").is("revoked_at", null);
  for (const device of (devices ?? []) as Array<{ id: string }>) {
    await queueVideoRenderNotification(client, videoRenderId, device.id, kind);
  }
}

async function renderLoop(): Promise<void> {
  const client = buildClient();
  const jobs = new SupabaseJobQueueRepository(client);
  for (;;) {
    try {
      const job = await jobs.claimNext(["render_video"]);
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const payload = job.payload as unknown as RenderJobPayload;
      console.log(`[render] claimed job ${job.id} for video_render ${payload.videoRenderId}`);
      try {
        await renderOne(client, payload);
        await jobs.markSucceeded(job.id);
        console.log(`[render] job ${job.id} succeeded`);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        console.error(`[render] job ${job.id} failed: ${message}`);
        const attemptsAfterThisFailure = job.attempts + 1;
        const decision = decideRetry(attemptsAfterThisFailure, job.maxAttempts);
        await jobs.markFailed(job.id, message, decision.runAfter, decision.deadLetter);
        if (decision.deadLetter) {
          await client
            .from("video_renders")
            .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
            .eq("id", payload.videoRenderId);
          await queueReadyOrFailedNotifications(client, payload.videoRenderId, "failed");
        }
      }
    } catch (err) {
      console.error(`[render] loop error: ${(err as Error).message}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function notificationLoop(): Promise<void> {
  const client = buildClient();
  const leaseOwner = `worker-${process.pid}`;
  for (;;) {
    try {
      const notification = await claimVideoRenderNotification(client, leaseOwner, 60);
      if (!notification) {
        await sleep(NOTIFICATION_POLL_INTERVAL_MS);
        continue;
      }
      const { data: render } = await client
        .from("video_renders")
        .select("error, campaign_assets(campaigns(thesis))")
        .eq("id", notification.videoRenderId)
        .maybeSingle();
      const renderRow = render as unknown as { error: string | null; campaign_assets: { campaigns: { thesis: string } | null } | null } | null;
      const campaignTitle = renderRow?.campaign_assets?.campaigns?.thesis ?? "Your video";
      const { data: device } = await client
        .from("device_push_tokens")
        .select("fcm_token")
        .eq("id", notification.deviceTokenId)
        .maybeSingle();
      if (!device) {
        await recordVideoRenderNotificationFailure(client, notification, "device token no longer exists", false);
        continue;
      }
      const result = await sendRenderNotification((device as { fcm_token: string }).fcm_token, {
        videoRenderId: notification.videoRenderId,
        kind: notification.kind,
        campaignTitle,
        error: renderRow?.error ?? null,
      });
      if (result.ok) {
        await markVideoRenderNotificationSent(client, notification.id);
      } else {
        await recordVideoRenderNotificationFailure(client, notification, result.error ?? "unknown FCM error", result.isRevokedToken);
      }
    } catch (err) {
      console.error(`[notify] loop error: ${(err as Error).message}`);
      await sleep(NOTIFICATION_POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("fillbook video render worker starting...");
console.log(`Work dir: ${WORK_DIR}`);
mkdirSync(WORK_DIR, { recursive: true });
Promise.all([renderLoop(), notificationLoop()]).catch((err) => {
  console.error("Fatal worker error:", err);
  process.exitCode = 1;
});
