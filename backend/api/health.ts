import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getServiceClient } from "../src/lib/supabaseClient";

/**
 * Integrations that genuinely require an owner-created OAuth app/developer
 * account and are not yet connected -- see docs/PROGRESS_LEDGER.md Phase 4
 * and Phase 9/11/12. Hardcoded here (not queried from integration_health)
 * because there is nothing to poll yet; once each is wired up, its status
 * should come from a real integration_health row instead.
 */
const NOT_YET_CONNECTED = [
  { label: "Search Console", detail: "Needs a Google Cloud OAuth app (owner action)" },
  { label: "X", detail: "Needs an X developer app (owner action)" },
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
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  for (const item of NOT_YET_CONNECTED) {
    health.push({ label: item.label, status: "NOT_CONNECTED", detail: item.detail });
  }

  res.status(200).json({ health });
}
