import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

/**
 * Integrations that genuinely require an owner-created OAuth app/developer
 * account and are not yet connected -- see docs/PROGRESS_LEDGER.md Phase 4
 * and Phase 9/11/12. Hardcoded here (not queried from integration_health)
 * because there is nothing to poll yet; once each is wired up, its status
 * should come from a real integration_health row instead.
 */
const NOT_YET_CONNECTED = [
  { label: "Search Console", detail: "Needs a Google Cloud OAuth app (owner action)" },
  { label: "TikTok", detail: "Promote is account-blocked; organic staging only, not yet wired" },
  { label: "YouTube", detail: "Needs a Google Cloud OAuth app (owner action)" },
  { label: "AI provider", detail: "Needs an API key for deep content review (owner action)" },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const health: { label: string; status: string; detail: string }[] = [];

  try {
    const client = getServiceClient();
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
    health.push({
      label: "Supabase",
      status: "DOWN",
      detail: errorMessage(err),
    });
  }

  for (const item of NOT_YET_CONNECTED) {
    health.push({ label: item.label, status: "NOT_CONNECTED", detail: item.detail });
  }

  // A row in signal_ingestion_cursors for x_mention only ever gets written
  // after a real, successful call to X's API (see xIngestion.ts) -- so its
  // presence is real evidence the adapter works, not just that
  // credentials exist.
  try {
    const client = getServiceClient();
    const { data } = await client
      .from("signal_ingestion_cursors")
      .select("updated_at")
      .eq("source", "x_mention")
      .maybeSingle();
    if (data) {
      health.push({
        label: "X",
        status: "HEALTHY",
        detail: `Verified live -- last synced ${(data as { updated_at: string }).updated_at}`,
      });
    } else {
      health.push({
        label: "X",
        status: "DEGRADED",
        detail: "Credentials wired, not yet verified against the real API",
      });
    }
  } catch (err) {
    health.push({ label: "X", status: "DEGRADED", detail: errorMessage(err) });
  }

  res.status(200).json({ health });
}
