import type { SupabaseClient } from "@supabase/supabase-js";
import { METRIC_FIELDS, parseMetricsCsv, validatePublishedMetadata, type PlatformMetrics, type PublishedVideoMetadata } from "./metadata.js";
import type { Platform } from "./types.js";

export interface MetadataKey {
  platform: Platform;
  experimentId: string;
  variationId: string;
}

/**
 * Storage for manually published video metadata and hand-entered platform metrics. Nothing here reaches
 * out to TikTok or YouTube; the owner publishes by hand and types or imports the numbers afterwards.
 */
export interface VideoPerformanceRepository {
  upsertMetadata(meta: PublishedVideoMetadata): Promise<string>;
  findMetadataId(key: MetadataKey): Promise<string | null>;
  recordMetrics(metadataId: string, metrics: PlatformMetrics): Promise<void>;
}

const SNAKE: Record<string, string> = {
  averageViewDurationSeconds: "average_view_duration_seconds",
  viewedVsSwipedAwayPct: "viewed_vs_swiped_away_pct",
  completionRatePct: "completion_rate_pct",
  percentageViewed: "percentage_viewed",
  engagedViews: "engaged_views",
  profileVisits: "profile_visits",
  followersGained: "followers_gained",
  websiteClicks: "website_clicks",
  attributedSignupStarts: "attributed_signup_starts",
  attributedCompletedSignups: "attributed_completed_signups",
  attributedActivations: "attributed_activations",
};

/** Maps metrics to columns, keeping null as null. Exported so a test can prove no null becomes 0. */
export function metricsToRow(metadataId: string, metrics: PlatformMetrics): Record<string, unknown> {
  const row: Record<string, unknown> = { metadata_id: metadataId, captured_at: metrics.capturedAt, source: metrics.source };
  for (const field of METRIC_FIELDS) row[SNAKE[field] ?? field] = metrics[field] ?? null;
  return row;
}

export class SupabaseVideoPerformanceRepository implements VideoPerformanceRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsertMetadata(meta: PublishedVideoMetadata): Promise<string> {
    const { data, error } = await this.client
      .from("video_publication_metadata")
      .upsert(
        {
          platform: meta.platform,
          title: meta.title,
          caption: meta.caption,
          hashtags: meta.hashtags,
          handle_in_caption: meta.handlePlacement.inCaption,
          handle_in_closing_visual: meta.handlePlacement.inClosingVisual,
          series: meta.series,
          topic: meta.topic,
          hook: meta.hook,
          cta: meta.cta,
          duration_seconds: meta.durationSeconds,
          voice: meta.voice,
          visual_style: meta.visualStyle,
          experiment_id: meta.experimentId,
          variation_id: meta.variationId,
          published_url: meta.publishedUrl ?? null,
          published_at: meta.publishedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform,experiment_id,variation_id" },
      )
      .select("id")
      .single();
    if (error || !data) throw new Error(`upsertMetadata failed: ${error?.message ?? "no row"}`);
    return (data as { id: string }).id;
  }

  async findMetadataId(key: MetadataKey): Promise<string | null> {
    const { data, error } = await this.client
      .from("video_publication_metadata")
      .select("id")
      .eq("platform", key.platform)
      .eq("experiment_id", key.experimentId)
      .eq("variation_id", key.variationId)
      .maybeSingle();
    if (error) throw new Error(`findMetadataId failed: ${error.message}`);
    return data ? (data as { id: string }).id : null;
  }

  async recordMetrics(metadataId: string, metrics: PlatformMetrics): Promise<void> {
    const { error } = await this.client.from("video_platform_metrics").insert(metricsToRow(metadataId, metrics));
    if (error) throw new Error(`recordMetrics failed: ${error.message}`);
  }
}

export class InMemoryVideoPerformanceRepository implements VideoPerformanceRepository {
  readonly metadata = new Map<string, PublishedVideoMetadata & { id: string }>();
  readonly metrics: Array<{ metadataId: string; metrics: PlatformMetrics }> = [];
  private seq = 0;

  private key(k: MetadataKey): string {
    return `${k.platform}|${k.experimentId}|${k.variationId}`;
  }

  async upsertMetadata(meta: PublishedVideoMetadata): Promise<string> {
    const k = this.key(meta);
    const existing = this.metadata.get(k);
    const id = existing?.id ?? `meta-${++this.seq}`;
    this.metadata.set(k, { ...meta, id });
    return id;
  }
  async findMetadataId(key: MetadataKey): Promise<string | null> {
    return this.metadata.get(this.key(key))?.id ?? null;
  }
  async recordMetrics(metadataId: string, metrics: PlatformMetrics): Promise<void> {
    this.metrics.push({ metadataId, metrics });
  }
}

export interface ImportSummary {
  imported: number;
  errors: Array<{ line: number; message: string }>;
}

/** Saves validated metadata for a video the owner published by hand. Refuses metadata that breaks any rule. */
export async function saveMetadata(repo: VideoPerformanceRepository, meta: PublishedVideoMetadata): Promise<string> {
  const errors = validatePublishedMetadata(meta).filter((i) => i.severity === "error");
  if (errors.length > 0) throw new Error(`Metadata is invalid: ${errors.map((e) => e.message).join(" ")}`);
  return repo.upsertMetadata(meta);
}

/** Imports a metrics CSV. Rows whose video has no saved metadata are reported, not created or guessed. */
export async function importMetricsCsv(repo: VideoPerformanceRepository, csvText: string, now: Date = new Date()): Promise<ImportSummary> {
  const { rows, errors } = parseMetricsCsv(csvText, now.toISOString());
  const summary: ImportSummary = { imported: 0, errors: [...errors] };
  for (const row of rows) {
    const id = await repo.findMetadataId({ platform: row.platform!, experimentId: row.experimentId!, variationId: row.variationId! });
    if (!id) {
      summary.errors.push({ line: row.line, message: `No published-video metadata for ${row.platform}/${row.experimentId}/${row.variationId}. Save the video's metadata first.` });
      continue;
    }
    await repo.recordMetrics(id, row.metrics);
    summary.imported += 1;
  }
  return summary;
}
