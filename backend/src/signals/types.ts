export type PrivacyClassification = "public" | "aggregated" | "internal_sensitive";

export interface Signal {
  id: string;
  source: string;
  topic: string | null;
  evidence: Record<string, unknown>;
  observedAt: Date;
  confidence: number;
  velocity: number | null;
  fillbookRelevance: number | null;
  audienceRelevance: number | null;
  privacyClassification: PrivacyClassification;
  sourceReference: string | null;
  clusterId: string | null;
}

export interface IngestSignalInput {
  source: string;
  topic: string | null;
  evidence: Record<string, unknown>;
  observedAt: Date;
  confidence?: number;
  fillbookRelevance?: number;
  audienceRelevance?: number;
  privacyClassification?: PrivacyClassification;
  sourceReference?: string | null;
}

export interface SignalRepository {
  insert(signal: Omit<Signal, "id" | "clusterId">): Promise<Signal>;
  findRecentByTopic(topic: string, sinceHours: number, now?: Date): Promise<Signal[]>;
  assignCluster(signalId: string, clusterId: string): Promise<void>;
}
