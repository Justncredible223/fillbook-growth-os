import type { SupabaseClient } from "@supabase/supabase-js";
import type { Signal, SignalRepository } from "./types";

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

function fromRow(row: SignalRow): Signal {
  return {
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
  };
}

export class SupabaseSignalRepository implements SignalRepository {
  constructor(private client: SupabaseClient) {}

  async insert(signal: Omit<Signal, "id" | "clusterId">): Promise<Signal> {
    const { data, error } = await this.client
      .from("signals")
      .insert({
        source: signal.source,
        topic: signal.topic,
        evidence: signal.evidence,
        observed_at: signal.observedAt.toISOString(),
        confidence: signal.confidence,
        velocity: signal.velocity,
        fillbook_relevance: signal.fillbookRelevance,
        audience_relevance: signal.audienceRelevance,
        privacy_classification: signal.privacyClassification,
        source_reference: signal.sourceReference,
      })
      .select()
      .single();
    if (error) throw new Error(`insert signal failed: ${error.message}`);
    return fromRow(data as SignalRow);
  }

  async findRecentByTopic(topic: string, sinceHours: number, now: Date = new Date()): Promise<Signal[]> {
    const cutoff = new Date(now.getTime() - sinceHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from("signals")
      .select()
      .eq("topic", topic)
      .gte("observed_at", cutoff);
    if (error) throw new Error(`findRecentByTopic failed: ${error.message}`);
    return (data as SignalRow[] ?? []).map(fromRow);
  }

  async assignCluster(signalId: string, clusterId: string): Promise<void> {
    const { error } = await this.client.from("signals").update({ cluster_id: clusterId }).eq("id", signalId);
    if (error) throw new Error(`assignCluster failed: ${error.message}`);
  }
}
