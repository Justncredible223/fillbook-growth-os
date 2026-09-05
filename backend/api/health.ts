import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

interface HealthItem {
  label: string;
  status: string;
  detail: string;
}

/**
 * No deployed endpoint calls the deep-review agents yet, so there's no
 * content_scores evidence to check the way Search Console checks for a
 * real signals row. A live API call on every health-check hit would cost
 * real money per poll, so this checks env var presence only -- verified
 * to actually work against the real API and real workspace once,
 * out-of-band (see docs/PROGRESS_LEDGER.md Phase 6).
 */
function checkAiProvider(): HealthItem {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasWorkspace = Boolean(process.env.ANTHROPIC_WORKSPACE_ID);
  if (hasKey && hasWorkspace) {
    return { label: "AI provider", status: "HEALTHY", detail: "ANTHROPIC_API_KEY + ANTHROPIC_WORKSPACE_ID configured" };
  }
  if (hasKey && !hasWorkspace) {
    return {
      label: "AI provider",
      status: "DEGRADED",
      detail: "ANTHROPIC_API_KEY set but ANTHROPIC_WORKSPACE_ID missing -- identity-linked keys need both",
    };
  }
  return { label: "AI provider", status: "NOT_CONNECTED", detail: "Needs an API key for deep content review (owner action)" };
}

/**
 * A row for `cursorSource` in signal_ingestion_cursors only ever gets
 * written after a real, successful ingest call (see xIngestion.ts) --
 * its presence is real evidence the adapter works, not just that
 * credentials exist.
 */
async function checkCursorBackedIntegration(
  client: SupabaseClient,
  label: string,
  cursorSource: string,
  notYetVerifiedDetail: string,
): Promise<HealthItem> {
  try {
    const { data } = await client
      .from("signal_ingestion_cursors")
      .select("updated_at")
      .eq("source", cursorSource)
      .maybeSingle();
    if (data) {
      return { label, status: "HEALTHY", detail: `Verified live -- last synced ${(data as { updated_at: string }).updated_at}` };
    }
    return { label, status: "DEGRADED", detail: notYetVerifiedDetail };
  } catch (err) {
    return { label, status: "DEGRADED", detail: errorMessage(err) };
  }
}

/**
 * Search Console has no cursor (it's a periodic snapshot, not a discrete
 * event stream -- see searchConsoleIngestion.ts), so "has it ever
 * ingested successfully" is instead evidenced by the presence of any
 * search_console_query signal row.
 */
async function checkSearchConsole(client: SupabaseClient): Promise<HealthItem> {
  try {
    const { count } = await client
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("source", "search_console_query");
    if ((count ?? 0) > 0) {
      return { label: "Search Console", status: "HEALTHY", detail: `Verified live -- ${count} query signals ingested` };
    }
    return {
      label: "Search Console",
      status: "DEGRADED",
      detail: "Credentials wired, not yet verified against the real API",
    };
  } catch (err) {
    return { label: "Search Console", status: "DEGRADED", detail: errorMessage(err) };
  }
}

/**
 * Reads `integration_health` (previously a dead table -- see
 * docs/PROGRESS_LEDGER.md's inbound-engagement audit) for the inbound
 * sync's real attempt/success/error state. This is deliberately not the
 * same check as X's `checkCursorBackedIntegration` above: a cursor
 * existing only proves ingestion worked ONCE, ever -- it can't tell a
 * caller "the last three attempts failed silently," which is exactly the
 * gap that lets a broken sync present as a merely-empty (not visibly
 * broken) inbound queue.
 */
async function checkInboundSync(client: SupabaseClient): Promise<HealthItem> {
  try {
    const { data } = await client
      .from("integration_health")
      .select("last_attempted_at, last_success_at, last_error")
      .eq("platform", "x_inbound")
      .maybeSingle();
    if (!data) {
      return { label: "Inbound Engagement", status: "NOT_CONNECTED", detail: "Never synced yet -- runs daily via /api/daily-pipeline" };
    }
    const row = data as { last_attempted_at: string | null; last_success_at: string | null; last_error: string | null };
    if (row.last_error) {
      return { label: "Inbound Engagement", status: "DOWN", detail: `Last attempt failed (${row.last_attempted_at}): ${row.last_error}` };
    }
    if (!row.last_success_at) {
      return { label: "Inbound Engagement", status: "DEGRADED", detail: `Attempted at ${row.last_attempted_at}, no confirmed success yet` };
    }
    return { label: "Inbound Engagement", status: "HEALTHY", detail: `Verified live -- last synced ${row.last_success_at}` };
  } catch (err) {
    return { label: "Inbound Engagement", status: "DOWN", detail: errorMessage(err) };
  }
}

/** Same real attempt/success/error evidence as checkInboundSync above, keyed to Prospecting's own integration_health row -- a search failure (rate limit, expired token, etc.) must be visible here, not silently presented as "just an empty/thin queue today." */
async function checkProspectingSync(client: SupabaseClient): Promise<HealthItem> {
  try {
    const { data } = await client
      .from("integration_health")
      .select("last_attempted_at, last_success_at, last_error")
      .eq("platform", "prospecting")
      .maybeSingle();
    if (!data) {
      return { label: "Prospecting", status: "NOT_CONNECTED", detail: "Never synced yet -- runs daily via /api/daily-pipeline" };
    }
    const row = data as { last_attempted_at: string | null; last_success_at: string | null; last_error: string | null };
    if (row.last_error) {
      return { label: "Prospecting", status: "DOWN", detail: `Last attempt failed (${row.last_attempted_at}): ${row.last_error}` };
    }
    if (!row.last_success_at) {
      return { label: "Prospecting", status: "DEGRADED", detail: `Attempted at ${row.last_attempted_at}, no confirmed success yet` };
    }
    return { label: "Prospecting", status: "HEALTHY", detail: `Verified live -- last synced ${row.last_success_at}` };
  } catch (err) {
    return { label: "Prospecting", status: "DOWN", detail: errorMessage(err) };
  }
}

/** Same real attempt/success/error evidence as checkInboundSync, keyed to Reddit inbound's own integration_health row (platform="reddit_inbound", written by api/growth-pulse.ts). Independent of X's "Inbound Engagement" row -- a Reddit-specific failure (e.g. missing/expired REDDIT_* credentials) must show here on its own, not be masked by X's row staying healthy. */
async function checkRedditInboundSync(client: SupabaseClient): Promise<HealthItem> {
  try {
    const { data } = await client
      .from("integration_health")
      .select("last_attempted_at, last_success_at, last_error")
      .eq("platform", "reddit_inbound")
      .maybeSingle();
    if (!data) {
      return { label: "Reddit Inbound", status: "NOT_CONNECTED", detail: "Never synced yet -- runs 3x/day via /api/growth-pulse (needs REDDIT_* credentials, see docs/REDDIT_INTEGRATION.md)" };
    }
    const row = data as { last_attempted_at: string | null; last_success_at: string | null; last_error: string | null };
    if (row.last_error) {
      return { label: "Reddit Inbound", status: "DOWN", detail: `Last attempt failed (${row.last_attempted_at}): ${row.last_error}` };
    }
    if (!row.last_success_at) {
      return { label: "Reddit Inbound", status: "DEGRADED", detail: `Attempted at ${row.last_attempted_at}, no confirmed success yet` };
    }
    return { label: "Reddit Inbound", status: "HEALTHY", detail: `Verified live -- last synced ${row.last_success_at}` };
  } catch (err) {
    return { label: "Reddit Inbound", status: "DOWN", detail: errorMessage(err) };
  }
}

/** Same shape as checkRedditInboundSync, for Reddit's own 1x/day prospecting step (platform="reddit_prospecting"). */
async function checkRedditProspectingSync(client: SupabaseClient): Promise<HealthItem> {
  try {
    const { data } = await client
      .from("integration_health")
      .select("last_attempted_at, last_success_at, last_error")
      .eq("platform", "reddit_prospecting")
      .maybeSingle();
    if (!data) {
      return { label: "Reddit Prospecting", status: "NOT_CONNECTED", detail: "Never synced yet -- runs 1x/day via /api/growth-pulse (needs REDDIT_* credentials, see docs/REDDIT_INTEGRATION.md)" };
    }
    const row = data as { last_attempted_at: string | null; last_success_at: string | null; last_error: string | null };
    if (row.last_error) {
      return { label: "Reddit Prospecting", status: "DOWN", detail: `Last attempt failed (${row.last_attempted_at}): ${row.last_error}` };
    }
    if (!row.last_success_at) {
      return { label: "Reddit Prospecting", status: "DEGRADED", detail: `Attempted at ${row.last_attempted_at}, no confirmed success yet` };
    }
    return { label: "Reddit Prospecting", status: "HEALTHY", detail: `Verified live -- last synced ${row.last_success_at}` };
  } catch (err) {
    return { label: "Reddit Prospecting", status: "DOWN", detail: errorMessage(err) };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const health: HealthItem[] = [];
  const client = getServiceClient();

  try {
    const { error, count } = await client.from("system_jobs").select("id", { count: "exact", head: true });
    if (error) throw error;
    health.push({ label: "Supabase", status: "HEALTHY", detail: "fillbook-growth-os project, live" });

    const { count: deadLetterCount } = await client
      .from("system_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter");

    health.push({
      label: "Job queue",
      status: (deadLetterCount ?? 0) > 0 ? "DEGRADED" : "HEALTHY",
      detail: `${count ?? 0} total jobs, ${deadLetterCount ?? 0} dead-lettered`,
    });
  } catch (err) {
    health.push({ label: "Supabase", status: "DOWN", detail: errorMessage(err) });
  }

  health.push(checkAiProvider());
  health.push(
    await checkCursorBackedIntegration(client, "X", "x_mention", "Credentials wired, not yet verified against the real API"),
  );
  health.push(await checkSearchConsole(client));
  // YouTube and TikTok signal ingestion were removed outright (see
  // api/ingest.ts) -- video distribution happens through Fliki, outside
  // this system -- so they are deliberately absent here rather than
  // permanently reporting "not yet verified" for adapters that no longer
  // exist.

  health.push(await checkInboundSync(client));
  health.push(await checkProspectingSync(client));
  health.push(await checkRedditInboundSync(client));
  health.push(await checkRedditProspectingSync(client));

  res.status(200).json({ health });
}
