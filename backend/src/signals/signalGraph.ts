import { randomUUID } from "node:crypto";
import type { IngestSignalInput, Signal, SignalRepository } from "./types.js";

const CLUSTER_WINDOW_HOURS = 72;
const VELOCITY_WINDOW_HOURS = 24;

/**
 * Ingests raw signals, deduplicates/clusters them by topic within a
 * rolling window, and computes a simple velocity metric (how many
 * same-topic signals have landed in the last 24h) — this is the "signals
 * should track ... velocity ... confidence" requirement from the master
 * spec, kept intentionally simple until real volume justifies more.
 */
export class SignalGraph {
  constructor(private repo: SignalRepository) {}

  async ingest(input: IngestSignalInput, now: Date = new Date()): Promise<Signal> {
    const topic = input.topic;
    let clusterId: string = randomUUID();

    if (topic) {
      const recent = await this.repo.findRecentByTopic(topic, CLUSTER_WINDOW_HOURS, now);
      const existingCluster = recent.find((s) => s.clusterId)?.clusterId;
      if (existingCluster) clusterId = existingCluster;
    }

    const inserted = await this.repo.insert({
      source: input.source,
      topic,
      evidence: input.evidence,
      observedAt: input.observedAt,
      confidence: input.confidence ?? 0.5,
      velocity: topic ? await this.computeVelocity(topic, now) : null,
      fillbookRelevance: input.fillbookRelevance ?? null,
      audienceRelevance: input.audienceRelevance ?? null,
      privacyClassification: input.privacyClassification ?? "public",
      sourceReference: input.sourceReference ?? null,
    });

    await this.repo.assignCluster(inserted.id, clusterId);
    return { ...inserted, clusterId };
  }

  private async computeVelocity(topic: string, now: Date): Promise<number> {
    const recent = await this.repo.findRecentByTopic(topic, VELOCITY_WINDOW_HOURS, now);
    return recent.length;
  }
}
