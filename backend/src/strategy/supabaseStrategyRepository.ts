import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatorOpportunityCandidate,
  FormatStats,
  SeoOpportunityCandidate,
  StrategyRecommendation,
  StrategyRepository,
  StrategyVersion,
  TopicStats,
} from "./types";

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function fromRow(row: Record<string, any>): StrategyVersion {
  return {
    id: row.id,
    version: row.version,
    generatedAt: row.generated_at,
    topicsToIncrease: row.topics_to_increase,
    topicsToDecrease: row.topics_to_decrease,
    contentToRetire: row.content_to_retire,
    formatsToTest: row.formats_to_test,
    seoOpportunities: row.seo_opportunities,
    creatorOpportunities: row.creator_opportunities,
    experimentsToRun: row.experiments_to_run,
    summary: row.summary,
    lowConfidence: row.low_confidence,
  };
}

export class SupabaseStrategyRepository implements StrategyRepository {
  constructor(private client: SupabaseClient) {}

  async getLatest(): Promise<StrategyVersion | null> {
    const { data, error } = await this.client
      .from("strategy_versions")
      .select()
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }

  async listHistory(limit: number): Promise<StrategyVersion[]> {
    const { data, error } = await this.client
      .from("strategy_versions")
      .select()
      .order("version", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async save(recommendation: StrategyRecommendation): Promise<StrategyVersion> {
    const latest = await this.getLatest();
    const nextVersion = (latest?.version ?? 0) + 1;

    const { data, error } = await this.client
      .from("strategy_versions")
      .insert({
        version: nextVersion,
        topics_to_increase: recommendation.topicsToIncrease,
        topics_to_decrease: recommendation.topicsToDecrease,
        content_to_retire: recommendation.contentToRetire,
        formats_to_test: recommendation.formatsToTest,
        seo_opportunities: recommendation.seoOpportunities,
        creator_opportunities: recommendation.creatorOpportunities,
        experiments_to_run: recommendation.experimentsToRun,
        summary: recommendation.summary,
        low_confidence: recommendation.lowConfidence,
      })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data);
  }
}

/**
 * Real aggregation against this project's own tables -- campaigns/
 * campaign_assets/content_versions/content_scores for topic+format
 * performance, signals for SEO candidates, creators for stale
 * relationships. No FillbookHQ database access (there is none from this
 * project, by design -- see docs/ARCHITECTURE.md).
 */
export async function collectStrategyEngineInputs(client: SupabaseClient, now: Date) {
  const { data: campaignRows, error: campaignsError } = await client
    .from("campaigns")
    .select("id, opportunity_id, opportunities(id, title, score)");
  if (campaignsError) throw campaignsError;

  const topicStatsByOpportunity = new Map<string, TopicStats>();
  const formatStatsByKey = new Map<string, FormatStats>();

  for (const campaign of (campaignRows ?? []) as Array<any>) {
    const opportunity = campaign.opportunities;
    if (!opportunity) continue;

    const { data: assetRows, error: assetsError } = await client
      .from("campaign_assets")
      .select("id, platform, asset_type, stage")
      .eq("campaign_id", campaign.id);
    if (assetsError) throw assetsError;

    let topicStat = topicStatsByOpportunity.get(opportunity.id);
    if (!topicStat) {
      topicStat = {
        topic: opportunity.title,
        opportunityId: opportunity.id,
        campaignCount: 0,
        reachedReadyForOwnerCount: 0,
        totalContentScorePasses: 0,
        totalContentScoreFails: 0,
        latestOpportunityScore: Number(opportunity.score),
      };
      topicStatsByOpportunity.set(opportunity.id, topicStat);
    }
    topicStat.campaignCount++;

    for (const asset of (assetRows ?? []) as Array<any>) {
      const reachedReady = asset.stage === "ready_for_owner" || asset.stage === "handed_off";
      if (reachedReady) topicStat.reachedReadyForOwnerCount++;

      const formatKey = `${asset.platform}::${asset.asset_type}`;
      let formatStat = formatStatsByKey.get(formatKey);
      if (!formatStat) {
        formatStat = {
          platform: asset.platform,
          assetType: asset.asset_type,
          assetCount: 0,
          reachedReadyForOwnerCount: 0,
          totalContentScorePasses: 0,
          totalContentScoreFails: 0,
        };
        formatStatsByKey.set(formatKey, formatStat);
      }
      formatStat.assetCount++;
      if (reachedReady) formatStat.reachedReadyForOwnerCount++;

      const { data: latestVersion } = await client
        .from("content_versions")
        .select("id")
        .eq("campaign_asset_id", asset.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestVersion) continue;

      const { data: scoreRows } = await client
        .from("content_scores")
        .select("verdict")
        .eq("content_version_id", latestVersion.id);
      for (const score of (scoreRows ?? []) as Array<{ verdict: string }>) {
        if (score.verdict === "pass") {
          topicStat.totalContentScorePasses++;
          formatStat.totalContentScorePasses++;
        } else {
          topicStat.totalContentScoreFails++;
          formatStat.totalContentScoreFails++;
        }
      }
    }
  }

  const { data: seoSignalRows, error: seoError } = await client
    .from("signals")
    .select("topic, velocity")
    .eq("source", "search_console")
    .not("topic", "is", null)
    .gte("observed_at", new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());
  if (seoError) throw seoError;

  const seoByTopic = new Map<string, number>();
  for (const row of (seoSignalRows ?? []) as Array<{ topic: string; velocity: number | null }>) {
    seoByTopic.set(row.topic, Math.max(seoByTopic.get(row.topic) ?? 0, row.velocity ?? 0));
  }
  const existingOpportunityTopics = new Set(
    [...topicStatsByOpportunity.values()].map((t) => t.topic.toLowerCase()),
  );
  const seoCandidates: SeoOpportunityCandidate[] = [...seoByTopic.entries()].map(([topic, velocity]) => ({
    topic,
    velocity,
    hasExistingOpportunity: existingOpportunityTopics.has(topic.toLowerCase()),
  }));

  const { data: creatorRows, error: creatorsError } = await client
    .from("creators")
    .select("id, handle, category, readiness_score, last_interaction_at")
    .in("category", ["tier_b", "research_next"]);
  if (creatorsError) throw creatorsError;

  const creatorCandidates: CreatorOpportunityCandidate[] = (creatorRows ?? []).map((row: any) => ({
    id: row.id,
    handle: row.handle,
    category: row.category,
    readinessScore: row.readiness_score,
    daysSinceLastInteraction: row.last_interaction_at ? daysBetween(now, new Date(row.last_interaction_at)) : null,
  }));

  return {
    topicStats: [...topicStatsByOpportunity.values()],
    formatStats: [...formatStatsByKey.values()],
    seoCandidates,
    creatorCandidates,
    now,
  };
}
