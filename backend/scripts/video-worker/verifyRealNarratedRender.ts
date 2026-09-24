#!/usr/bin/env node
/**
 * Runs the REAL worker entry point (runRender, the function video-render.yml invokes) against a fake, local,
 * in-memory Supabase client/storage/push sender -- no real database, upload, or push.
 *
 *   npx tsx scripts/video-worker/verifyRealNarratedRender.ts pilot-2 --voice=edge     (production edge-tts voice; free, network)
 *   npx tsx scripts/video-worker/verifyRealNarratedRender.ts pilot-2 --voice=offline  (Windows SAPI, no network)
 *
 * Output: out/release-voice/<planId>__edge-tts-production-voice.mp4 (or __offline-sapi-NOT-production-voice.mp4)
 * plus a per-scene timing report next to it.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runRender } from "./render-single.js";
import { createProcessRunner } from "../video-factory/processRunner.js";
import { isAvailable as offlineTtsAvailable } from "../video-factory/localTts.js";
import { PILOTS } from "../../src/shortform/pilots.js";
import { buildVideoScriptFromScenePlan } from "../../src/content/videoScriptWriter.js";

const voiceArg = process.argv.find((a) => a.startsWith("--voice="))?.slice("--voice=".length) ?? "offline";
if (voiceArg !== "edge" && voiceArg !== "offline") throw new Error(`--voice must be "edge" or "offline", got "${voiceArg}".`);
if (voiceArg === "offline") process.env.VIDEO_WORKER_OFFLINE_NARRATION = "true";
else delete process.env.VIDEO_WORKER_OFFLINE_NARRATION;

const planFilter = process.argv.slice(2).find((a) => !a.startsWith("--"));
const plan = PILOTS.find((p) => !planFilter || p.planId.includes(planFilter));
if (!plan) throw new Error(`No pilot matches "${planFilter}".`);

if (voiceArg === "offline" && !offlineTtsAvailable()) {
  console.error("Offline narration (Windows SAPI) is not available on this host.");
  process.exit(1);
}

/** Exactly what the campaign pipeline stores for a motion-concept request: the canonical script built from the plan. */
function fakeApprovedRowFor(p: (typeof PILOTS)[number]) {
  const videoScript = buildVideoScriptFromScenePlan(p);
  return {
    campaignAssetsRow: {
      id: "verify-asset",
      platform: "tiktok",
      asset_type: "video_script",
      campaign_id: "verify-campaign",
      campaigns: { thesis: "Local verification render", status: "approved", decided_by: "Owner (local verification)", decided_at: new Date().toISOString() },
    },
    contentVersionsRow: { body: videoScript.script, metadata: { videoScript } },
  };
}

function createLocalFakeClient(row: ReturnType<typeof fakeApprovedRowFor>, localOutDir: string) {
  function builderFor(table: string): any {
    const builder: any = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      is: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (table === "campaign_assets") return { data: row.campaignAssetsRow, error: null };
        if (table === "content_versions") return { data: row.contentVersionsRow, error: null };
        return { data: null, error: null };
      },
      update: () => builder,
      then: (resolve: (v: unknown) => void) => resolve({ data: table === "device_push_tokens" ? [] : null, error: null }),
    };
    return builder;
  }
  return {
    from: (table: string) => builderFor(table),
    storage: {
      from: () => ({
        upload: async (path: string, buffer: Buffer) => {
          mkdirSync(localOutDir, { recursive: true });
          writeFileSync(join(localOutDir, path), buffer);
          return { error: null };
        },
      }),
    },
    rpc: async (fn: string) => {
      if (fn === "reserve_video_storage_bytes") return { data: [{ reservation_id: "local-verification", eligible: true, reason: null }], error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
}

async function main() {
  const p = plan!;
  const tag = voiceArg === "edge" ? "edge-tts-production-voice" : "offline-sapi-NOT-production-voice";
  const workDir = join(process.cwd(), "..", "out", `worker-verify-${voiceArg}`);
  const localStorageDir = join(workDir, "_local-storage");
  const client = createLocalFakeClient(fakeApprovedRowFor(p), localStorageDir);
  const runner = createProcessRunner();
  const sendPush = async () => ({ ok: true, isRevokedToken: false });

  const videoRenderId = `verify-${p.planId}`;
  console.log(`\n=== REAL runRender() for "${p.planId}", voice=${voiceArg}, local fake DB/storage ===`);
  const result = await runRender(videoRenderId, "verify-asset", { client, runner, workDir, sendPush });

  console.log(`Narration provenance: ${result.motionSelection.narrationProvenance}`);
  console.log(`Reported duration: ${result.durationSeconds.toFixed(2)}s`);

  const outDir = join(process.cwd(), "..", "out", "release-voice");
  mkdirSync(outDir, { recursive: true });
  const delivered = join(outDir, `${p.planId}__${tag}.mp4`);
  copyFileSync(join(workDir, videoRenderId, "final.mp4"), delivered);
  readFileSync(join(localStorageDir, `${videoRenderId}.mp4`));
  writeFileSync(join(outDir, `${p.planId}__${tag}.selection.json`), JSON.stringify(result.motionSelection, null, 2));
  console.log(`Rendered: ${delivered}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
