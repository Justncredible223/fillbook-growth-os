import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, mapWithConcurrency } from "../lib/concurrency.js";
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
 * How many ids go into one `.in()` filter. PostgREST encodes the list in
 * the request URL, so this is bounded to keep every request comfortably
 * under URL-length limits; 100 uuids is ~3.7 KB.
 */
export const STRATEGY_BATCH_SIZE = 100;
/** How many batch reads run at once. Small on purpose: this runs inside the daily pipeline alongside other steps sharing the same connection pool. */
export const STRATEGY_BATCH_CONCURRENCY = 4;

/** Thrown when any of the aggregation reads fails -- names the read so the pipeline step detail is specific. */
export class StrategyCollectionError extends Error {
  constructor(public readonly query: string, cause: { message: string }) {
    super(`strategy input query "${query}" failed: ${cause.message}`);
    this.name = "StrategyCollectionError";
  }
}

/**
 * Fetches `table` rows whose `column` is in `ids`, in bounded `.in()`
 * batches run with limited concurrency. One failed batch fails the whole
 * read -- a partial aggregate would silently skew the strategy report.
 */
async function fetchByIdsInBatches<T>(client: SupabaseClient, table: string, select: string, column: string, ids: string[], label: string): Promise<T[]> {
  const batches = chunk(ids, STRATEGY_BATCH_SIZE);
  const pages = await mapWithConcurrency(batches, STRATEGY_BATCH_CONCURRENCY, async (batch) => {
    const { data, error } = await client.from(table).select(select).in(column, batch);
    if (error) throw new StrategyCollectionError(label, error);
    return (data ?? []) as T[];
  });
  return pages.flat();
}

interface CampaignRow {
  id: string;
  opportunity_id: string | null;
  opportunities: { id: string; title: string; score: number } | { id: string; title: string; score: number }[] | null;
}
interface AssetRow {
  id: string;
  campaign_id: string;
  platform: string;
  asset_type: string;
  stage: string;
}
interface VersionRow {
  id: string;
  campaign_asset_id: string;
  version: number;
}
interface ScoreRow {
  content_version_id: string;
  verdict: string;
}

/**
 * Real aggregation against this project's own tables -- campaigns/
 * campaign_assets/content_versions/content_scores for topic+format
 * performance, signals for SEO candidates, creators for stale
 * relationships. No FillbookHQ database access (there is none from this
 * project, by design -- see docs/ARCHITECTURE.md).
 *
 * Query shape is bounded regardless of content history: one campaigns
 * read, then assets / versions / scores each fetched by id lists in
 * STRATEGY_BATCH_SIZE batches (STRATEGY_BATCH_CONCURRENCY at a time), then
 * one signals read and one creators read. For C campaigns, A assets and V
 * versions that is 3 + ceil(C/100) + ceil(A/100) + ceil(L/100) requests
 * where L is the number of latest versions -- versus the previous
 * 1 + C + 2A sequential round-trips, which could exhaust a serverless
 * invocation's time budget on a modest history.
 *
 * "Latest version" keeps its exact meaning: for each asset, the
 * content_versions row with the highest `version` number, and ONLY that
 * row's scores count -- identical to the previous per-asset
 * `.order("version", desc).limit(1)` read.
 */
export async function collectStrategyEngineInputs(client: SupabaseClient, now: Date) {
  const campaigns = await client.from("campaigns").select("id, opportunity_id, opportunities(id, title, score)");
  if (campaigns.error) throw new StrategyCollectionError("campaigns", campaigns.error);
  const campaignRows = (campaigns.data ?? []) as CampaignRow[];

  const topicStatsByOpportunity = new Map<string, TopicStats>();
  const formatStatsByKey = new Map<string, FormatStats>();
  const topicStatByCampaignId = new Map<string, TopicStats>();

  for (const campaign of campaignRows) {
    const opportunity = Array.isArray(campaign.opportunities) ? campaign.opportunities[0] : campaign.opportunities;
    if (!opportunity) continue;

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
    topicStatByCampaignId.set(campaign.id, topicStat);
  }

  // Assets for every campaign that has an opportunity, in one batched read.
  const assetRows = await fetchByIdsInBatches<AssetRow>(
    client,
    "campaign_assets",
    "id, campaign_id, platform, asset_type, stage",
    "campaign_id",
    [...topicStatByCampaignId.keys()],
    "campaign_assets",
  );

  const formatStatByAssetId = new Map<string, FormatStats>();
  for (const asset of assetRows) {
    const topicStat = topicStatByCampaignId.get(asset.campaign_id);
    if (!topicStat) continue;

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
    formatStatByAssetId.set(asset.id, formatStat);
  }

  // All versions for those assets in one batched read, reduced to the
  // single highest-numbered version per asset in memory.
  const versionRows = await fetchByIdsInBatches<VersionRow>(
    client,
    "content_versions",
    "id, campaign_asset_id, version",
    "campaign_asset_id",
    assetRows.map((a) => a.id),
    "content_versions",
  );
  const latestVersionByAssetId = new Map<string, VersionRow>();
  for (const version of versionRows) {
    const current = latestVersionByAssetId.get(version.campaign_asset_id);
    if (!current || version.version > current.version) latestVersionByAssetId.set(version.campaign_asset_id, version);
  }
  const assetIdByLatestVersionId = new Map<string, string>();
  for (const [assetId, version] of latestVersionByAssetId) assetIdByLatestVersionId.set(version.id, assetId);

  // Scores for ONLY the latest versions, one batched read.
  const scoreRows = await fetchByIdsInBatches<ScoreRow>(
    client,
    "content_scores",
    "content_version_id, verdict",
    "content_version_id",
    [...assetIdByLatestVersionId.keys()],
    "content_scores",
  );
  const assetById = new Map(assetRows.map((a) => [a.id, a] as const));
  for (const score of scoreRows) {
    const assetId = assetIdByLatestVersionId.get(score.content_version_id);
    if (!assetId) continue;
    const asset = assetById.get(assetId);
    const formatStat = formatStatByAssetId.get(assetId);
    const topicStat = asset ? topicStatByCampaignId.get(asset.campaign_id) : undefined;
    if (!formatStat || !topicStat) continue;
    if (score.verdict === "pass") {
      topicStat.totalContentScorePasses++;
      formatStat.totalContentScorePasses++;
    } else {
      topicStat.totalContentScoreFails++;
      formatStat.totalContentScoreFails++;
    }
  }

  const seoSignals = await client
    .from("signals")
    .select("topic, velocity")
    .eq("source", "search_console")
    .not("topic", "is", null)
    .gte("observed_at", new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString());
  if (seoSignals.error) throw new StrategyCollectionError("signals", seoSignals.error);

  const seoByTopic = new Map<string, number>();
  for (const row of (seoSignals.data ?? []) as Array<{ topic: string; velocity: number | null }>) {
    seoByTopic.set(row.topic, Math.max(seoByTopic.get(row.topic) ?? 0, row.velocity ?? 0));
  }
  const existingOpportunityTopics = new Set([...topicStatsByOpportunity.values()].map((t) => t.topic.toLowerCase()));
  const seoCandidates: SeoOpportunityCandidate[] = [...seoByTopic.entries()].map(([topic, velocity]) => ({
    topic,
    velocity,
    hasExistingOpportunity: existingOpportunityTopics.has(topic.toLowerCase()),
  }));

  const creators = await client
    .from("creators")
    .select("id, handle, category, readiness_score, last_interaction_at")
    .in("category", ["tier_b", "research_next"]);
  if (creators.error) throw new StrategyCollectionError("creators", creators.error);

  const creatorCandidates: CreatorOpportunityCandidate[] = (creators.data ?? []).map((row: any) => ({
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
