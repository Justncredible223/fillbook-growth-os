/**
 * Supabase Edge Function: trigger-video-render
 *
 * Called by a Supabase Database Webhook on INSERT into system_jobs
 * where job_type = 'render_video'. Dispatches the GitHub Actions
 * video-render workflow via repository_dispatch.
 *
 * Setup:
 *   1. Deploy: supabase functions deploy trigger-video-render
 *   2. Set secrets:
 *        supabase secrets set GH_PAT=<your GitHub PAT with repo scope>
 *        supabase secrets set GH_REPO=Justncredible223/fillbook-growth-os
 *   3. In Supabase Dashboard → Database → Webhooks → Create webhook:
 *        Table: system_jobs
 *        Events: INSERT
 *        URL: https://<project-ref>.supabase.co/functions/v1/trigger-video-render
 *        HTTP method: POST
 *        HTTP headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();

    // Database webhook payload: { type, table, record, old_record, schema }
    const record = body?.record as Record<string, unknown> | undefined;
    if (!record || record["job_type"] !== "render_video") {
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const payload = record["payload"] as Record<string, string> | undefined;
    const videoRenderId = payload?.["videoRenderId"];
    const campaignAssetId = payload?.["campaignAssetId"];

    if (!videoRenderId || !campaignAssetId) {
      return new Response(
        JSON.stringify({ error: "Missing videoRenderId or campaignAssetId in job payload" }),
        { status: 400 }
      );
    }

    const ghPat = Deno.env.get("GH_PAT");
    const ghRepo = Deno.env.get("GH_REPO"); // e.g. "Justncredible223/fillbook-growth-os"
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

    return new Response(JSON.stringify({ dispatched: true, videoRenderId }), { status: 200 });
  } catch (err) {
    console.error("[trigger-video-render]", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
