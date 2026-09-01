import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

interface HealthItem {
  label: string;
  status: string;
  detail: string;
}

/**
 * Integrations that genuinely require an owner-created OAuth app/developer
 * account and are not yet connected -- see docs/PROGRESS_LEDGER.md Phase 4
 * and Phase 9/11/12. Hardcoded here (not queried from integration_health)
 * because there is nothing to poll yet; once each is wired up, its status
 * should come from a real integration_health row instead.
 */
const NOT_YET_CONNECTED = [
  { label: "TikTok", detail: "Promote is account-blocked; organic staging only, not yet wired" },
];

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
 * written after a real, successful ingest call (see xIngestion.ts /
 * youtubeIngestion.ts) -- its presence is real evidence the adapter
 * works, not just that credentials exist.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  for (const item of NOT_YET_CONNECTED) {
    health.push({ label: item.label, status: "NOT_CONNECTED", detail: item.detail });
  }

  health.push(checkAiProvider());
  health.push(
    await checkCursorBackedIntegration(client, "X", "x_mention", "Credentials wired, not yet verified against the real API"),
  );
  health.push(await checkSearchConsole(client));
  health.push(
    await checkCursorBackedIntegration(
      client,
      "YouTube",
      "youtube_video",
      "Credentials wired, not yet verified against the real API",
    ),
  );

  res.status(200).json({ health });
}
