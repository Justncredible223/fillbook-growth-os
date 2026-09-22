/**
 * Supabase Edge Function: trigger-campaign-run
 *
 * Exact mirror of trigger-video-render (see that file's own doc comment for
 * the full reasoning) applied to the `run_campaign` job type instead of
 * `render_video`:
 *   1. Fast path -- Database Webhook on INSERT into system_jobs where
 *      job_type = 'run_campaign'. Claims that one row and dispatches the
 *      GitHub Actions campaign-run workflow via repository_dispatch.
 *   2. Sweep path -- POST body {"sweep": true}, for a periodic backstop
 *      call (see backend/api/growth-pulse.ts's videoReconciliation step
 *      for the equivalent call site this should eventually join).
 * Both funnel into the same claim -> dispatch -> complete/fail job-queue
 * lifecycle every other job type in this codebase uses (migration 0003's
 * claim_job/complete_job/fail_job).
 *
 * Setup:
 *   1. Deploy: supabase functions deploy trigger-campaign-run
 *      (GH_PAT/GH_REPO secrets are shared with trigger-video-render --
 *      nothing new to set if that function is already configured.)
 *   2. In Supabase Dashboard -> Database -> Webhooks -> Create webhook:
 *        Table: system_jobs
 *        Events: INSERT
 *        URL: https://<project-ref>.supabase.co/functions/v1/trigger-campaign-run
 *        HTTP method: POST
 *        HTTP headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Mirrors backend/src/jobs/backoff.ts's decideRetry exactly -- same
// duplication rationale as trigger-video-render (Deno vs Node/Vercel).
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

async function dispatchToGithub(campaignRunRequestId: string, opportunityId: string, assetTypeOverride: string | null): Promise<void> {
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
      event_type: "campaign-run",
      client_payload: { campaignRunRequestId, opportunityId, assetTypeOverride },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub dispatch failed ${resp.status}: ${text}`);
  }
}

/** Same role as trigger-video-render's claimSpecificJob. */
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
 * matching campaign_run_requests row 'failed' -- scoped to
 * `.eq("status", "queued")` so this can never clobber a run that DID
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
  if (failError) console.error("[trigger-campaign-run] fail_job failed:", failError.message);

  if (decision.deadLetter) {
    const campaignRunRequestId = (job.payload as Record<string, string> | null)?.campaignRunRequestId;
    if (campaignRunRequestId) {
      const { error: updateError } = await client
        .from("campaign_run_requests")
        .update({
          status: "failed",
          error: `Dispatch never succeeded after ${attemptsAfterThisFailure} attempt(s): ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", campaignRunRequestId)
        .eq("status", "queued");
      if (updateError) console.error("[trigger-campaign-run] failed to mark campaign_run_requests row failed:", updateError.message);
    }
  }
}

/**
 * Given an already-claimed job, dispatches it and applies
 * complete_job/fail_job. Guards against re-dispatching a stale job (the
 * campaign_run_requests row already reached a terminal state, or is
 * missing) before ever calling GitHub -- same reasoning as
 * trigger-video-render's own stale-job guard.
 */
async function dispatchAndFinish(client: SupabaseClient, job: SystemJobRow): Promise<void> {
  const payload = job.payload as Record<string, string> | null;
  const campaignRunRequestId = payload?.campaignRunRequestId;
  const opportunityId = payload?.opportunityId;
  const assetTypeOverride = payload?.assetTypeOverride ?? null;
  if (!campaignRunRequestId || !opportunityId) {
    await recordDispatchFailure(client, job, "Missing campaignRunRequestId or opportunityId in job payload");
    return;
  }

  const { data: run, error: runError } = await client
    .from("campaign_run_requests")
    .select("status")
    .eq("id", campaignRunRequestId)
    .maybeSingle();
  if (runError) {
    await recordDispatchFailure(client, job, `Failed to check campaign_run_requests row before dispatch: ${runError.message}`);
    return;
  }
  if (!run || run.status !== "queued") {
    console.log(
      `[trigger-campaign-run] skipping stale job ${job.id} -- campaign_run_requests row is ${run ? `status='${run.status}'` : "missing"}, not 'queued'`,
    );
    const { error } = await client.rpc("complete_job", { p_job_id: job.id });
    if (error) console.error("[trigger-campaign-run] complete_job (stale skip) failed:", error.message);
    return;
  }

  try {
    await dispatchToGithub(campaignRunRequestId, opportunityId, assetTypeOverride);
    const { error } = await client.rpc("complete_job", { p_job_id: job.id });
    if (error) console.error("[trigger-campaign-run] complete_job failed:", error.message);
  } catch (err) {
    await recordDispatchFailure(client, job, (err as Error).message);
  }
}

/** Sweep path: drains every run_campaign job left claimable, bounded to 10 per invocation. */
async function runSweep(client: SupabaseClient): Promise<{ processed: number }> {
  let processed = 0;
  for (let i = 0; i < 10; i++) {
    const { data, error } = await client.rpc("claim_job", { p_job_types: ["run_campaign"] });
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
    if (!record || record["job_type"] !== "run_campaign") {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const claimed = await claimSpecificJob(client, record["id"] as string);
    if (!claimed) {
      return new Response(JSON.stringify({ skipped: true, reason: "already claimed" }), { status: 200 });
    }

    await dispatchAndFinish(client, claimed);
    return new Response(
      JSON.stringify({ dispatched: true, campaignRunRequestId: (claimed.payload as Record<string, string>)?.campaignRunRequestId }),
      { status: 200 },
    );
  } catch (err) {
    console.error("[trigger-campaign-run]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
