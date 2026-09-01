import type { SupabaseClient } from "@supabase/supabase-js";
import { BrandConstitution } from "../knowledge/brandConstitution.js";
import { SupabaseBrandConstitutionRepository } from "../knowledge/supabaseRepositories.js";
import { ContentQualityGate } from "./contentQualityGate.js";
import { CampaignFactory } from "./campaignFactory.js";
import { SupabaseContentScoreRepository, type ContentScoreRepository } from "./contentScoreRepository.js";
import { SupabaseCampaignRepository } from "./supabaseCampaignRepository.js";
import { createLlmClient, LlmClient, type LlmUsage } from "./llmClient.js";
import { runCampaignPipeline, type CampaignRepository, type PipelineOpportunity, type PipelineResult } from "./campaignPipeline.js";
import { recordCostEvent, estimateCostUsd } from "../cost/costTracking.js";

export type CampaignRunSource = "manual" | "auto-draft";

export interface RunCampaignDeps {
  llmClient: LlmClient;
  factory: CampaignFactory;
  scoreRepo: ContentScoreRepository;
  campaignRepo: CampaignRepository;
  brandRulesSummary: string;
  verifiedKnowledgeSummary: string;
  recentTextsForSameTopic: string[];
  /** Called only when the pipeline reaches ready_for_owner -- never otherwise. */
  markOpportunityActioned: (opportunityId: string) => Promise<void>;
  /** Called only when the pipeline reaches ready_for_owner. Sets 'in_review', NOT 'approved' -- AI review is not human approval. */
  markCampaignInReview: (campaignId: string) => Promise<void>;
}

/**
 * The core orchestration, fully testable with injected in-memory deps --
 * no Supabase required. Used by both the manual /api/run-campaign
 * endpoint and the scheduled auto-draft step (api/daily-pipeline.ts) via
 * buildSupabaseRunCampaignDeps below, so there is exactly one
 * implementation of "run one opportunity through the pipeline and update
 * its status on success," not two that could drift apart.
 */
export async function runCampaignForOpportunity(
  deps: RunCampaignDeps,
  opportunity: PipelineOpportunity,
): Promise<PipelineResult> {
  const result = await runCampaignPipeline(deps.llmClient, deps.factory, deps.scoreRepo, deps.campaignRepo, opportunity, {
    brandRulesSummary: deps.brandRulesSummary,
    verifiedKnowledgeSummary: deps.verifiedKnowledgeSummary,
    recentTextsForSameTopic: deps.recentTextsForSameTopic,
  });

  if (result.finalStage === "ready_for_owner") {
    await deps.markOpportunityActioned(opportunity.id);
    await deps.markCampaignInReview(result.campaignId);
  }

  return result;
}

export interface UsageTracker {
  usages: LlmUsage[];
  aiCalls(): number;
  costUsd(): number;
}

function createUsageTracker(): UsageTracker {
  const usages: LlmUsage[] = [];
  return {
    usages,
    aiCalls: () => usages.length,
    costUsd: () => usages.reduce((sum, u) => sum + estimateCostUsd(u), 0),
  };
}

/**
 * Builds the real Supabase-backed deps for production use. Fetches brand
 * rules / verified knowledge / recent drafts fresh on every call (same
 * as the original run-campaign.ts always did) rather than caching --
 * volume here is low enough that staleness risk isn't worth the
 * complexity.
 */
export async function buildSupabaseRunCampaignDeps(
  client: SupabaseClient,
  /**
   * Returns the opportunity id to tag cost events with. A function, not a
   * fixed string, because the auto-draft path builds these deps before
   * it has selected which opportunity it will actually run -- selection
   * happens inside runAutoDraftStep, after these deps (including the
   * LlmClient's cost-recording callback) already exist.
   */
  getOpportunityId: () => string,
  source: CampaignRunSource,
): Promise<{ deps: RunCampaignDeps; usage: UsageTracker }> {
  const brandConstitution = new BrandConstitution(new SupabaseBrandConstitutionRepository(client));
  const activeRules = await brandConstitution.getActiveRules();
  const brandRulesSummary = activeRules.map((r) => `[${r.ruleType}] ${r.content}`).join("\n");

  const { data: knowledgeRows } = await client.from("knowledge_documents").select("title, content").eq("trust_level", "verified");
  const verifiedKnowledgeSummary = (knowledgeRows ?? [])
    .map((row: { title: string; content: string }) => `${row.title}: ${row.content}`)
    .join("\n");

  const { data: recentVersions } = await client
    .from("content_versions")
    .select("body")
    .order("created_at", { ascending: false })
    .limit(10);
  const recentTextsForSameTopic = (recentVersions ?? []).map((row: { body: string }) => row.body);

  const usage = createUsageTracker();
  const llmClient = createLlmClient(process.env, (u: LlmUsage) => {
    usage.usages.push(u);
    void recordCostEvent(client, u, { opportunityId: getOpportunityId(), endpoint: "run-campaign", source });
  });

  const deps: RunCampaignDeps = {
    llmClient,
    factory: new CampaignFactory(new ContentQualityGate(brandConstitution)),
    scoreRepo: new SupabaseContentScoreRepository(client),
    campaignRepo: new SupabaseCampaignRepository(client),
    brandRulesSummary,
    verifiedKnowledgeSummary,
    recentTextsForSameTopic,
    markOpportunityActioned: async (id) => {
      await client.from("opportunities").update({ status: "actioned", updated_at: new Date().toISOString() }).eq("id", id);
    },
    markCampaignInReview: async (id) => {
      await client.from("campaigns").update({ status: "in_review", updated_at: new Date().toISOString() }).eq("id", id);
    },
  };

  return { deps, usage };
}
