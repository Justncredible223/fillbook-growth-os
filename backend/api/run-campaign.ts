import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { BrandConstitution } from "../src/knowledge/brandConstitution.js";
import { SupabaseBrandConstitutionRepository } from "../src/knowledge/supabaseRepositories.js";
import { ContentQualityGate } from "../src/content/contentQualityGate.js";
import { CampaignFactory } from "../src/content/campaignFactory.js";
import { SupabaseContentScoreRepository } from "../src/content/contentScoreRepository.js";
import { SupabaseCampaignRepository } from "../src/content/supabaseCampaignRepository.js";
import { createLlmClient } from "../src/content/llmClient.js";
import { runCampaignPipeline } from "../src/content/campaignPipeline.js";

/**
 * Runs one opportunity through the full Opportunity -> draft -> mechanical
 * gate -> nine-agent deep review -> ready_for_owner pipeline. Ties
 * together every piece built separately in Phases 5 and 6 into one real,
 * end-to-end run. Never publishes anything -- the furthest an asset can
 * reach here is 'ready_for_owner', same EXTERNAL_DRAFT-only guarantee as
 * the rest of CampaignFactory. Costs real LLM tokens (one drafting call
 * plus up to nine review calls), so POST-only, not something a GET/poll
 * should ever trigger.
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

    const brandConstitution = new BrandConstitution(new SupabaseBrandConstitutionRepository(client));
    const activeRules = await brandConstitution.getActiveRules();
    const brandRulesSummary = activeRules.map((r) => `[${r.ruleType}] ${r.content}`).join("\n");

    const { data: knowledgeRows } = await client
      .from("knowledge_documents")
      .select("title, content")
      .eq("trust_level", "verified");
    const verifiedKnowledgeSummary = (knowledgeRows ?? [])
      .map((row: { title: string; content: string }) => `${row.title}: ${row.content}`)
      .join("\n");

    const { data: recentVersions } = await client
      .from("content_versions")
      .select("body")
      .order("created_at", { ascending: false })
      .limit(10);
    const recentTextsForSameTopic = (recentVersions ?? []).map((row: { body: string }) => row.body);

    const llmClient = createLlmClient();
    const factory = new CampaignFactory(new ContentQualityGate(brandConstitution));
    const scoreRepo = new SupabaseContentScoreRepository(client);
    const campaignRepo = new SupabaseCampaignRepository(client);

    const result = await runCampaignPipeline(llmClient, factory, scoreRepo, campaignRepo, opportunity, {
      brandRulesSummary,
      verifiedKnowledgeSummary,
      recentTextsForSameTopic,
    });

    if (result.finalStage === "ready_for_owner") {
      await client.from("opportunities").update({ status: "actioned", updated_at: new Date().toISOString() }).eq("id", opportunity.id);
      await client.from("campaigns").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", result.campaignId);
    }

    res.status(200).json({ result });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
