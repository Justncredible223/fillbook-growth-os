import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { OpportunityEngine } from "../src/opportunities/opportunityEngine.js";
import { generateOpportunitiesFromSignals } from "../src/opportunities/opportunityGenerator.js";
import type { Signal } from "../src/signals/types.js";

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
 * The missing link between Signal Graph (Phase 4) and Opportunity Engine
 * (Phase 5): pulls recent signals, skips any already covered by an
 * existing opportunity (checked via opportunities.signal_ids), and turns
 * the rest into real scored Opportunity rows. POST-only and idempotent
 * to re-run -- already-covered signals are always skipped, never
 * duplicated.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
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
    const result = await generateOpportunitiesFromSignals(engine, recentSignals, alreadyCoveredSignalIds);

    res.status(200).json({ result });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
