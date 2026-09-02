import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { runGenerateOpportunities } from "../src/opportunities/runGenerateOpportunities.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

/**
 * The missing link between Signal Graph (Phase 4) and Opportunity Engine
 * (Phase 5): pulls recent signals, skips any already covered by an
 * existing opportunity (checked via opportunities.signal_ids), and turns
 * the rest into real scored Opportunity rows. POST-only and idempotent
 * to re-run -- already-covered signals are always skipped, never
 * duplicated. Also runs as part of the scheduled daily-pipeline cron
 * job (api/daily-pipeline.ts) -- this endpoint remains for manual/
 * on-demand triggering.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const result = await runGenerateOpportunities(getServiceClient());
    res.status(200).json({ result });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
