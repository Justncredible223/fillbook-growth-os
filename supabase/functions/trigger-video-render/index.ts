/**
 * Supabase Edge Function: trigger-video-render
 *
 * Two invocation shapes:
 *   1. Fast path -- called by a Supabase Database Webhook on INSERT into
 *      system_jobs where job_type = 'render_video'. Claims that one row
 *      and dispatches the GitHub Actions video-render workflow via
 *      repository_dispatch immediately.
 *   2. Sweep path -- POST body {"sweep": true}, called periodically from
 *      backend/api/growth-pulse.ts's videoReconciliation step. Drains any
 *      render_video jobs left `pending` and due (run_after <= now()) --
 *      the backstop for whenever the webhook never fired at all, or fired
 *      and its dispatch failed and got backed off for a later retry.
 *
 * Both paths funnel into the SAME claim -> dispatch -> complete/fail
 * job-queue lifecycle (migration 0003's claim_job/complete_job/fail_job)
 * every other job type in this codebase already uses. Added 2026-09-19
 * after a real incident: a dead GH_PAT secret made every dispatch fail
 * with "401 Bad credentials", but the old version of this function never
 * touched system_jobs on success OR failure -- so the job sat `pending`
 * forever with zero visibility and zero retry, and the app just showed
 * "queued" indefinitely. Now:
 *   - A successful dispatch calls complete_job (previously nothing did,
 *     even on success -- every past render_video job row is still stuck
 *     at status='pending' despite having actually rendered).
 *   - A failed dispatch calls fail_job with the same backoff policy as
 *     backend/src/jobs/backoff.ts (kept in sync by hand -- Deno and the
 *     Vercel/Node backend can't share that module across the runtime
 *     boundary), so it's retried by the sweep with growing delay.
 *   - Once max_attempts is exhausted, the job is dead-lettered AND its
 *     video_renders row is marked status='failed' with a real error, so
 *     the app shows a real failure instead of an eternal "queued".
 *   - The fast path atomically claims its own row (UPDATE ... WHERE
 *     status='pending') before dispatching, so a webhook delivery racing
 *     the sweep's claim_job can never double-dispatch the same job --
 *     whichever gets the row lock first wins, the other sees 0 rows and
 *     backs off.
 *
 * Setup:
 *   1. Deploy: supabase functions deploy trigger-video-render
 *   2. Set secrets:
 *        supabase secrets set GH_PAT=<your GitHub PAT with repo scope>
 *        supabase secrets set GH_REPO=Justncredible223/fillbook-growth-os
 *      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by
 *      Supabase into every Edge Function -- nothing to set for those.)
 *   3. In Supabase Dashboard -> Database -> Webhooks -> Create webhook:
 *        Table: system_jobs
 *        Events: INSERT
 *        URL: https://<project-ref>.supabase.co/functions/v1/trigger-video-render
 *        HTTP method: POST
 *        HTTP headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Mirrors backend/src/jobs/backoff.ts's decideRetry exactly -- see that
// file's own doc comment for why the policy is shaped this way. Duplicated
// rather than imported because this function runs on Deno and that module
// lives in the Node/Vercel backend; if you change one, change both.
const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 30 * 60_000; // 30 min cap

interface RetryDecision {
  deadLetter: boolean;
  runAfterIso: string;
}

function decideRetry(attemptsAfterThisFailure: number, maxAttempts: number, now: Date = new Date()): RetryDecision {
  if (attemptsAfterThisFailure >= maxAttempts) {
    return { deadLetter: true, runAfterIso: now.toISOString() };
  }
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attemptsAfterThisFailure - 1), MAX_DELAY_MS);
  return { deadLetter: false, runAfterIso: new Date(now.getTime() + delay).toISOString() };
}

interface SystemJobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available to this function");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function dispatchToGithub(videoRenderId: string, campaignAssetId: string): Promise<void> {
  const ghPat = Deno.env.get("GH_PAT");
  const ghRepo = Deno.env.get("GH_REPO");
  if (!ghPat || !ghRepo) {
    throw new Error("GH_PAT and GH_REPO secrets must be set on this Edge Function");
  }

  const resp = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `token ${ghPat}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "fillbook-supabase-edge",
    },
    body: JSON.stringify({
      event_type: "video-render",
      client_payload: { videoRenderId, campaignAssetId },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub dispatch failed ${resp.status}: ${text}`);
  }
}

/**
 * Atomically claims one specific, already-known job row (the fast path's
 * equivalent of claim_job's CTE, scoped to a single id instead of "the
 * next due one"). Returns null if it's already been claimed by something
 * else (the sweep, or a duplicate webhook delivery) -- the caller should
 * just no-op in that case, never re-dispatch.
 */
async function claimSpecificJob(client: SupabaseClient, jobId: string): Promise<SystemJobRow | null> {
  const { data, error } = await client
    .from("system_jobs")
    .update({ status: "running", locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "pending")
    .select("id, job_type, payload, attempts, max_attempts")
    .maybeSingle();
  if (error) throw new Error(`claim failed: ${error.message}`);
  return (data as SystemJobRow | null) ?? null;
}

/**
 * Records a failed dispatch attempt via fail_job with the standard
 * backoff/dead-letter decision. Once dead-lettered, also marks the
 * matching video_renders row 'failed' with a real error message -- scoped
 * to `.eq("status", "queued")` so this can never clobber a render that DID
 * start (e.g. a concurrent sweep attempt that succeeded a moment later).
 */
async function recordDispatchFailure(client: SupabaseClient, job: SystemJobRow, message: string): Promise<void> {
  const attemptsAfterThisFailure = job.attempts + 1;
  const decision = decideRetry(attemptsAfterThisFailure, job.max_attempts);
  const { error: failError } = await client.rpc("fail_job", {
    p_job_id: job.id,
    p_error: message,
    p_run_after: decision.runAfterIso,
    p_dead_letter: decision.deadLetter,
  });
  if (failError) console.error("[trigger-video-render] fail_job failed:", failError.message);

  if (decision.deadLetter) {
    const videoRenderId = (job.payload as Record<string, string> | null)?.videoRenderId;
    if (videoRenderId) {
      const { error: updateError } = await client
        .from("video_renders")
        .update({
          status: "failed",
          error: `Dispatch never succeeded after ${attemptsAfterThisFailure} attempt(s): ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", videoRenderId)
        .eq("status", "queued");
      if (updateError) console.error("[trigger-video-render] failed to mark video_renders row failed:", updateError.message);
    }
  }
}

/** Given an already-claimed job, dispatches it and applies complete_job/fail_job. Never throws -- both outcomes are terminal handling, not something the caller needs to react to further. */
async function dispatchAndFinish(client: SupabaseClient, job: SystemJobRow): Promise<void> {
  const payload = job.payload as Record<string, string> | null;
  const videoRenderId = payload?.videoRenderId;
  const campaignAssetId = payload?.campaignAssetId;
  if (!videoRenderId || !campaignAssetId) {
    await recordDispatchFailure(client, job, "Missing videoRenderId or campaignAssetId in job payload");
    return;
  }

  try {
    await dispatchToGithub(videoRenderId, campaignAssetId);
    const { error } = await client.rpc("complete_job", { p_job_id: job.id });
    if (error) console.error("[trigger-video-render] complete_job failed:", error.message);
  } catch (err) {
    await recordDispatchFailure(client, job, (err as Error).message);
  }
}

/** Sweep path: drains every render_video job left claimable, bounded to 10 per invocation so a bug that always reclaims something can never loop unboundedly inside one request. */
async function runSweep(client: SupabaseClient): Promise<{ processed: number }> {
  let processed = 0;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await client.rpc("claim_job", { p_job_types: ["render_video"] });
    if (error) throw new Error(`claim_job failed: ${error.message}`);
    const rows = data as SystemJobRow[] | null;
    if (!rows || rows.length === 0) break;
    processed++;
    await dispatchAndFinish(client, rows[0]!);
  }
  return { processed };
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const client = getServiceClient();

    if (body?.sweep === true) {
      const result = await runSweep(client);
      return new Response(JSON.stringify({ swept: true, ...result }), { status: 200 });
    }

    // Database webhook payload: { type, table, record, old_record, schema }
    const record = body?.record as Record<string, unknown> | undefined;
    if (!record || record["job_type"] !== "render_video") {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const claimed = await claimSpecificJob(client, record["id"] as string);
    if (!claimed) {
      // Already claimed by the sweep, or a duplicate webhook delivery.
      return new Response(JSON.stringify({ skipped: true, reason: "already claimed" }), { status: 200 });
    }

    await dispatchAndFinish(client, claimed);
    return new Response(JSON.stringify({ dispatched: true, videoRenderId: (claimed.payload as Record<string, string>)?.videoRenderId }), { status: 200 });
  } catch (err) {
    console.error("[trigger-video-render]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
