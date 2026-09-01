import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseOpportunityRepository } from "./supabaseOpportunityRepository.js";
import { OpportunityEngine } from "./opportunityEngine.js";
import { generateOpportunitiesFromSignals, type GenerateOpportunitiesResult } from "./opportunityGenerator.js";
import type { Signal } from "../signals/types.js";

const LOOKBACK_HOURS = 24 * 7;

interface SignalRow {
  id: string;
  source: string;
  topic: string | null;
  evidence: Record<string, unknown>;
  observed_at: string;
  confidence: number;
  velocity: number | null;
  fillbook_relevance: number | null;
  audience_relevance: number | null;
  privacy_classification: Signal["privacyClassification"];
  source_reference: string | null;
  cluster_id: string | null;
}

/**
 * Shared by the manual POST /api/generate-opportunities endpoint and the
 * scheduled daily-pipeline cron job, so there's exactly one place that
 * knows how to turn recent signal rows into real Opportunity rows.
 */
export async function runGenerateOpportunities(client: SupabaseClient): Promise<GenerateOpportunitiesResult> {
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const { data: signalRows, error: signalsError } = await client
    .from("signals")
    .select(
      "id, source, topic, evidence, observed_at, confidence, velocity, fillbook_relevance, audience_relevance, privacy_classification, source_reference, cluster_id",
    )
    .gte("observed_at", cutoff);
  if (signalsError) throw signalsError;

  const recentSignals: Signal[] = ((signalRows ?? []) as SignalRow[]).map((row) => ({
    id: row.id,
    source: row.source,
    topic: row.topic,
    evidence: row.evidence,
    observedAt: new Date(row.observed_at),
    confidence: row.confidence,
    velocity: row.velocity,
    fillbookRelevance: row.fillbook_relevance,
    audienceRelevance: row.audience_relevance,
    privacyClassification: row.privacy_classification,
    sourceReference: row.source_reference,
    clusterId: row.cluster_id,
  }));

  const { data: opportunityRows, error: oppError } = await client.from("opportunities").select("signal_ids");
  if (oppError) throw oppError;
  const alreadyCoveredSignalIds = new Set<string>(
    ((opportunityRows ?? []) as Array<{ signal_ids: string[] | null }>).flatMap((row) => row.signal_ids ?? []),
  );

  const engine = new OpportunityEngine(new SupabaseOpportunityRepository(client));
  return generateOpportunitiesFromSignals(engine, recentSignals, alreadyCoveredSignalIds);
}
