import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { runCampaignForOpportunity, buildSupabaseRunCampaignDeps } from "../src/content/runCampaignForOpportunity.js";

/**
 * Manual trigger: runs one opportunity through the full Opportunity ->
 * draft -> mechanical gate -> nine-agent deep review -> ready_for_owner
 * pipeline. Never publishes anything -- the furthest an asset can reach
 * here is 'ready_for_owner'. Costs real LLM tokens (one drafting call
 * plus up to nine review calls), so POST-only. See
 * src/content/runCampaignForOpportunity.ts for the shared, testable
 * implementation also used by the scheduled auto-draft step
 * (api/daily-pipeline.ts) -- this endpoint tags its cost events
 * source: "manual" to distinguish itself from that automated path.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const opportunityId = (req.body as { opportunityId?: string } | undefined)?.opportunityId;

    const opportunityRepo = new SupabaseOpportunityRepository(client);
    const openOpportunities = await opportunityRepo.listOpen();
    const opportunity = opportunityId
      ? openOpportunities.find((o) => o.id === opportunityId)
      : openOpportunities[0];

    if (!opportunity) {
      res.status(404).json({ error: opportunityId ? `No open opportunity with id ${opportunityId}` : "No open opportunities to run" });
      return;
    }

    const { deps, usage } = await buildSupabaseRunCampaignDeps(client, () => opportunity.id, "manual");
    const result = await runCampaignForOpportunity(deps, opportunity);

    res.status(200).json({ result, aiCalls: usage.aiCalls(), costUsd: usage.costUsd() });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
