import { scanText } from "./claims.js";
import { TEXT_LIMITS } from "./layout.js";
import { OFFICIAL_HANDLE, type Platform, type PlanIssue, type ScenePlan } from "./types.js";

/** Hashtags the brand uses. Others are allowed, but these are the defaults. */
export const DEFAULT_HASHTAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingPsychology", "TradingDiscipline"] as const;

export interface PublishedVideoMetadata {
  platform: Platform;
  title: string;
  /** TikTok caption, or the YouTube Shorts description. Contains the handle exactly once. */
  caption: string;
  hashtags: string[];
  handlePlacement: { inCaption: boolean; inClosingVisual: boolean };
  series: string;
  topic: string;
  hook: string;
  cta: string;
  durationSeconds: number;
  voice: string;
  visualStyle: string;
  experimentId: string;
  variationId: string;
  /** Entered by the owner after posting by hand. Null until then. */
  publishedAt: string | null;
  publishedUrl?: string | null;
}

/**
 * Platform metrics, entered by hand or imported from CSV. Every field is nullable and stays null when the
 * platform did not report it: an unavailable number is never turned into zero.
 */
export interface PlatformMetrics {
  capturedAt: string;
  // "api" = fetched automatically (YouTube Analytics pull-back); see
  // src/video/youtubeAnalyticsRefresh.ts.
  source: "manual" | "csv" | "api";
  views: number | null;
  engagedViews: number | null;
  /** Share of viewers who stayed to watch rather than swiped away (0-100), where the platform reports it. */
  viewedVsSwipedAwayPct: number | null;
  averageViewDurationSeconds: number | null;
  /** Average percentage viewed (0-1000: Shorts that loop can exceed 100). */
  percentageViewed: number | null;
  /** Share of views that watched to the end (0-100). */
  completionRatePct: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  profileVisits: number | null;
  /** Followers (TikTok) or subscribers (YouTube) gained. Can be negative on YouTube (net). */
  followersGained: number | null;
  websiteClicks: number | null;
  attributedSignupStarts: number | null;
  attributedCompletedSignups: number | null;
  attributedActivations: number | null;
}

export const METRIC_FIELDS = [
  "views",
  "engagedViews",
  "viewedVsSwipedAwayPct",
  "averageViewDurationSeconds",
  "percentageViewed",
  "completionRatePct",
  "likes",
  "comments",
  "shares",
  "saves",
  "profileVisits",
  "followersGained",
  "websiteClicks",
  "attributedSignupStarts",
  "attributedCompletedSignups",
  "attributedActivations",
] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export function emptyMetrics(capturedAt: string, source: PlatformMetrics["source"] = "manual"): PlatformMetrics {
  const metrics = { capturedAt, source } as PlatformMetrics;
  for (const field of METRIC_FIELDS) metrics[field] = null;
  return metrics;
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
}

/**
 * Builds the platform-specific caption. TikTok: a caption with the handle once and 3-5 hashtags at the end.
 * YouTube Shorts: the same, as the description, with the title carried separately. Throws on an input that
 * cannot produce a valid caption rather than silently truncating it.
 */
export function composeCaption(body: string, platform: Platform, hashtags: string[]): { caption: string; hashtags: string[] } {
  const tags = [...new Set(hashtags.map(normalizeTag).filter(Boolean))];
  if (tags.length < 3 || tags.length > 5) throw new Error(`${platform} needs 3-5 hashtags; got ${tags.length}.`);
  const cleaned = body.replace(/@fillbookhq/gi, "").replace(/\s+/g, " ").trim();
  const caption = `${cleaned} ${OFFICIAL_HANDLE}\n${tags.map((t) => `#${t}`).join(" ")}`.trim();
  const limit = platform === "tiktok" ? TEXT_LIMITS.tiktokCaptionChars : TEXT_LIMITS.youtubeDescriptionChars;
  if (caption.length > limit) throw new Error(`${platform} caption is ${caption.length} characters; the limit is ${limit}.`);
  return { caption, hashtags: tags };
}

export function buildPublishedMetadata(
  plan: ScenePlan,
  platform: Platform,
  input: { title?: string; captionBody: string; hashtags: string[]; topic: string; cta: string; voice?: string; visualStyle?: string },
): PublishedVideoMetadata {
  const { caption, hashtags } = composeCaption(input.captionBody, platform, input.hashtags);
  const last = plan.scenes[plan.scenes.length - 1];
  const closingText = last ? [last.headline, last.captionText, last.cta ?? ""].join(" ").toLowerCase() : "";
  return {
    platform,
    title: (input.title ?? plan.title).trim(),
    caption,
    hashtags,
    handlePlacement: { inCaption: true, inClosingVisual: closingText.includes(OFFICIAL_HANDLE) },
    series: plan.series,
    topic: input.topic,
    hook: plan.hook,
    cta: input.cta,
    durationSeconds: Math.round(plan.scenes.reduce((s, sc) => s + sc.durationSeconds, 0) * 10) / 10,
    voice: input.voice ?? plan.voice,
    visualStyle: input.visualStyle ?? plan.visualStyle,
    experimentId: plan.experimentId,
    variationId: plan.variationId,
    publishedAt: null,
    publishedUrl: null,
  };
}

/** Validates one platform's metadata: title/caption limits, handle placement, hashtags, banned claims, timestamps. */
export function validatePublishedMetadata(meta: PublishedVideoMetadata): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (code: string, message: string, severity: PlanIssue["severity"] = "error") => issues.push({ severity, code, message });

  if (!meta.title.trim()) add("missing_title", "Title is empty.");
  if (meta.title.length > TEXT_LIMITS.titleChars) add("title_too_long", `Title is ${meta.title.length} characters; the limit is ${TEXT_LIMITS.titleChars}.`);
  const captionLimit = meta.platform === "tiktok" ? TEXT_LIMITS.tiktokCaptionChars : TEXT_LIMITS.youtubeDescriptionChars;
  if (meta.caption.length > captionLimit) add("caption_too_long", `Caption is ${meta.caption.length} characters; the ${meta.platform} limit is ${captionLimit}.`);

  const handleCount = (meta.caption.toLowerCase().match(/@fillbookhq/g) ?? []).length;
  if (handleCount !== 1) add("caption_handle_count", `${OFFICIAL_HANDLE} must appear exactly once in the caption (found ${handleCount}).`);
  if (!meta.handlePlacement.inCaption) add("handle_flag_inconsistent", "handlePlacement.inCaption is false, but every caption must carry the handle.");
  if (!meta.handlePlacement.inClosingVisual) add("closing_visual_handle_missing", `${OFFICIAL_HANDLE} must appear in the closing visual.`);

  if (meta.hashtags.length < 3 || meta.hashtags.length > 5) add("hashtag_count", `Use 3-5 hashtags; got ${meta.hashtags.length}.`);
  for (const tag of meta.hashtags) if (!/^[\p{L}\p{N}_]+$/u.test(tag)) add("hashtag_format", `Hashtag "${tag}" has characters other than letters, numbers or underscore.`);
  const captionTags = (meta.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((t) => t.slice(1).toLowerCase());
  for (const tag of meta.hashtags) if (!captionTags.includes(tag.toLowerCase())) add("hashtag_not_in_caption", `Hashtag #${tag} is listed but not in the caption text.`, "review");

  if (!meta.experimentId.trim() || !meta.variationId.trim()) add("missing_experiment", "Experiment and variation ids are required so results can be compared.");
  if (meta.publishedAt !== null && Number.isNaN(Date.parse(meta.publishedAt))) add("invalid_published_at", "publishedAt must be an ISO timestamp or null.");

  issues.push(...scanText(meta.title, "Title"), ...scanText(meta.caption, "Caption"));
  return issues;
}

/** Stable serialization: fixed key order, nulls preserved, so a stored record round-trips byte for byte. */
export function serializeMetadata(meta: PublishedVideoMetadata): string {
  const ordered = {
    platform: meta.platform,
    title: meta.title,
    caption: meta.caption,
    hashtags: meta.hashtags,
    handlePlacement: { inCaption: meta.handlePlacement.inCaption, inClosingVisual: meta.handlePlacement.inClosingVisual },
    series: meta.series,
    topic: meta.topic,
    hook: meta.hook,
    cta: meta.cta,
    durationSeconds: meta.durationSeconds,
    voice: meta.voice,
    visualStyle: meta.visualStyle,
    experimentId: meta.experimentId,
    variationId: meta.variationId,
    publishedAt: meta.publishedAt,
    publishedUrl: meta.publishedUrl ?? null,
  };
  return JSON.stringify(ordered, null, 2);
}

export function serializeMetrics(metrics: PlatformMetrics): string {
  const ordered: Record<string, unknown> = { capturedAt: metrics.capturedAt, source: metrics.source };
  for (const field of METRIC_FIELDS) ordered[field] = metrics[field] ?? null;
  return JSON.stringify(ordered, null, 2);
}

/* ------------------------------- CSV import ------------------------------- */

const COLUMN_ALIASES: Record<string, MetricField | "platform" | "experimentId" | "variationId" | "capturedAt"> = {
  platform: "platform",
  experiment_id: "experimentId",
  experiment: "experimentId",
  variation_id: "variationId",
  variation: "variationId",
  captured_at: "capturedAt",
  date: "capturedAt",
  views: "views",
  video_views: "views",
  engaged_views: "engagedViews",
  viewed_vs_swiped_away_pct: "viewedVsSwipedAwayPct",
  stayed_to_watch_pct: "viewedVsSwipedAwayPct",
  stayed_to_watch: "viewedVsSwipedAwayPct",
  average_view_duration_seconds: "averageViewDurationSeconds",
  average_view_duration: "averageViewDurationSeconds",
  avg_view_duration: "averageViewDurationSeconds",
  average_watch_time: "averageViewDurationSeconds",
  percentage_viewed: "percentageViewed",
  average_percentage_viewed: "percentageViewed",
  completion_rate_pct: "completionRatePct",
  completion_rate: "completionRatePct",
  watched_full_video: "completionRatePct",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saves",
  profile_visits: "profileVisits",
  profile_views: "profileVisits",
  followers_gained: "followersGained",
  new_followers: "followersGained",
  subscribers_gained: "followersGained",
  subscribers: "followersGained",
  website_clicks: "websiteClicks",
  attributed_signup_starts: "attributedSignupStarts",
  attributed_completed_signups: "attributedCompletedSignups",
  attributed_activations: "attributedActivations",
  attributed_activation: "attributedActivations",
};

const UNAVAILABLE = new Set(["", "n/a", "na", "-", "--", "—", "null", "none", "unavailable", "not available"]);
const PERCENT_FIELDS: ReadonlySet<MetricField> = new Set(["viewedVsSwipedAwayPct", "completionRatePct", "percentageViewed"]);

export interface CsvRow {
  line: number;
  platform: Platform | null;
  experimentId: string | null;
  variationId: string | null;
  metrics: PlatformMetrics;
}
export interface CsvError {
  line: number;
  message: string;
}

/** Splits CSV text into rows of cells, honoring quotes and CRLF. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Parses one metric cell. Returns undefined for an unparseable value (an error), null for "not reported". */
export function parseMetricCell(raw: string, field: MetricField): number | null | undefined {
  const cell = raw.trim();
  if (UNAVAILABLE.has(cell.toLowerCase())) return null;
  if (field === "averageViewDurationSeconds" && /^\d+:\d{2}(?::\d{2})?$/.test(cell)) {
    const parts = cell.split(":").map(Number);
    return parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!;
  }
  const match = /^(-?\d[\d,]*(?:\.\d+)?)\s*([kKmM%]?)$/.exec(cell);
  if (!match) return undefined;
  let value = Number(match[1]!.replace(/,/g, ""));
  const suffix = match[2]!.toLowerCase();
  if (suffix === "k") value *= 1_000;
  else if (suffix === "m") value *= 1_000_000;
  if (!Number.isFinite(value)) return undefined;
  if (value < 0 && field !== "followersGained") return undefined;
  if (PERCENT_FIELDS.has(field)) {
    const max = field === "percentageViewed" ? 1000 : 100;
    if (value > max) return undefined;
  }
  return value;
}

/**
 * Parses a metrics CSV. An empty or "N/A" cell becomes null; a missing column stays null for every row.
 * Bad cells are reported per line and the whole row is skipped, never guessed at or zero-filled.
 */
export function parseMetricsCsv(text: string, defaultCapturedAt: string): { rows: CsvRow[]; errors: CsvError[] } {
  const table = splitCsv(text);
  const rows: CsvRow[] = [];
  const errors: CsvError[] = [];
  if (table.length === 0) return { rows, errors: [{ line: 1, message: "The CSV is empty." }] };
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const columns = header.map((h) => COLUMN_ALIASES[h] ?? null);
  if (!columns.includes("experimentId") || !columns.includes("variationId") || !columns.includes("platform")) {
    return { rows, errors: [{ line: 1, message: "The CSV needs platform, experiment_id and variation_id columns." }] };
  }

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r]!;
    const metrics = emptyMetrics(defaultCapturedAt, "csv");
    let platform: Platform | null = null;
    let experimentId: string | null = null;
    let variationId: string | null = null;
    let bad = false;

    for (let c = 0; c < columns.length; c++) {
      const column = columns[c];
      const raw = cells[c] ?? "";
      if (!column) continue;
      if (column === "platform") {
        const p = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
        if (p === "tiktok") platform = "tiktok";
        else if (p === "youtube_shorts" || p === "youtube" || p === "shorts") platform = "youtube_shorts";
        else {
          errors.push({ line, message: `Unknown platform "${raw}".` });
          bad = true;
        }
      } else if (column === "experimentId") experimentId = raw.trim() || null;
      else if (column === "variationId") variationId = raw.trim() || null;
      else if (column === "capturedAt") {
        if (raw.trim()) {
          if (Number.isNaN(Date.parse(raw.trim()))) {
            errors.push({ line, message: `Invalid date "${raw}".` });
            bad = true;
          } else metrics.capturedAt = new Date(raw.trim()).toISOString();
        }
      } else {
        const parsed = parseMetricCell(raw, column);
        if (parsed === undefined) {
          errors.push({ line, message: `Cannot read "${raw}" for ${column}.` });
          bad = true;
        } else metrics[column] = parsed;
      }
    }
    if (!experimentId || !variationId) {
      errors.push({ line, message: "Missing experiment_id or variation_id." });
      bad = true;
    }
    if (!bad) rows.push({ line, platform, experimentId, variationId, metrics });
  }
  return { rows, errors };
}

const CSV_HEADER = ["platform", "experiment_id", "variation_id", "captured_at", ...METRIC_FIELDS.map((f) => f.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`))];

/** Writes rows back to CSV. A null metric is an empty cell, so a round trip never invents a zero. */
export function serializeMetricsCsv(rows: Array<{ platform: Platform; experimentId: string; variationId: string; metrics: PlatformMetrics }>): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    const cells = [row.platform, row.experimentId, row.variationId, row.metrics.capturedAt, ...METRIC_FIELDS.map((f) => (row.metrics[f] === null || row.metrics[f] === undefined ? "" : String(row.metrics[f])))];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}
