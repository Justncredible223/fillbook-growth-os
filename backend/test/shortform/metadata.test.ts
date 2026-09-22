import { describe, expect, it } from "vitest";
import {
  buildPublishedMetadata,
  composeCaption,
  emptyMetrics,
  METRIC_FIELDS,
  parseMetricCell,
  parseMetricsCsv,
  serializeMetadata,
  serializeMetrics,
  serializeMetricsCsv,
  splitCsv,
  validatePublishedMetadata,
  type PublishedVideoMetadata,
} from "../../src/shortform/metadata";
import { closingScene, makePlan, makeScene } from "./helpers";
import { InMemoryVideoPerformanceRepository, importMetricsCsv, metricsToRow, saveMetadata } from "../../src/shortform/performanceRepository";

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);
const TAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingPsychology", "TradingDiscipline"];

function baseMeta(over: Partial<PublishedVideoMetadata> = {}): PublishedVideoMetadata {
  const plan = makePlan([makeScene(), closingScene()]);
  const meta = buildPublishedMetadata(plan, "tiktok", { captionBody: "Read the buffer, not the balance.", hashtags: TAGS, topic: "buffer", cta: "Follow" });
  return { ...meta, ...over };
}

describe("composeCaption and @fillbookhq placement", () => {
  it("puts the handle exactly once and the hashtags at the end", () => {
    const { caption } = composeCaption("Read the buffer.", "tiktok", TAGS);
    expect((caption.match(/@fillbookhq/gi) ?? []).length).toBe(1);
    expect(caption.endsWith(TAGS.map((t) => `#${t}`).join(" "))).toBe(true);
  });
  it("strips any handle already in the body so it is never duplicated", () => {
    const { caption } = composeCaption("Follow @fillbookhq for more.", "tiktok", TAGS);
    expect((caption.match(/@fillbookhq/gi) ?? []).length).toBe(1);
  });
  it("requires 3-5 hashtags", () => {
    expect(() => composeCaption("x", "tiktok", ["a", "b"])).toThrow();
    expect(() => composeCaption("x", "tiktok", ["a", "b", "c", "d", "e", "f"])).toThrow();
  });
  it("enforces the platform caption length limit", () => {
    expect(() => composeCaption("x".repeat(3000), "tiktok", TAGS)).toThrow();
  });
});

describe("buildPublishedMetadata / validatePublishedMetadata", () => {
  it("builds valid metadata for a real pilot-shaped plan with no validation errors", () => {
    const meta = baseMeta();
    expect(validatePublishedMetadata(meta).filter((i) => i.severity === "error")).toEqual([]);
    expect(meta.handlePlacement.inClosingVisual).toBe(true);
  });

  it("flags a title over the character limit, a bad hashtag count, and a missing experiment id", () => {
    const meta = baseMeta({ title: "x".repeat(80), hashtags: ["one", "two"], experimentId: "" });
    const found = codes(validatePublishedMetadata(meta));
    expect(found).toContain("title_too_long");
    expect(found).toContain("hashtag_count");
    expect(found).toContain("missing_experiment");
  });

  it("flags a caption with zero or more than one handle mention", () => {
    const zero = baseMeta({ caption: "No handle here. #FuturesTrading #PropFirmTrading #TradingJournal" });
    expect(codes(validatePublishedMetadata(zero))).toContain("caption_handle_count");
    const twice = baseMeta({ caption: "@fillbookhq and @fillbookhq again. #FuturesTrading #PropFirmTrading #TradingJournal" });
    expect(codes(validatePublishedMetadata(twice))).toContain("caption_handle_count");
  });

  it("flags handlePlacement flags that contradict the actual caption/closing visual", () => {
    const meta = baseMeta({ handlePlacement: { inCaption: false, inClosingVisual: false } });
    const found = codes(validatePublishedMetadata(meta));
    expect(found).toContain("handle_flag_inconsistent");
    expect(found).toContain("closing_visual_handle_missing");
  });

  it("runs the same banned-claim scan on the title and caption", () => {
    const meta = baseMeta({ title: "This guarantees results", caption: `Guaranteed payouts every time @fillbookhq ${TAGS.map((t) => "#" + t).join(" ")}` });
    const found = codes(validatePublishedMetadata(meta));
    expect(found).toContain("guarantee_language");
  });

  it("rejects an invalid publishedAt that is not null", () => {
    expect(codes(validatePublishedMetadata(baseMeta({ publishedAt: "not a date" })))).toContain("invalid_published_at");
    expect(codes(validatePublishedMetadata(baseMeta({ publishedAt: null })))).not.toContain("invalid_published_at");
  });
});

describe("platform-specific metadata", () => {
  it("keeps tiktok and youtube_shorts metadata distinct for the same plan", () => {
    const plan = makePlan([makeScene(), closingScene()]);
    const tiktok = buildPublishedMetadata(plan, "tiktok", { captionBody: "a", hashtags: TAGS, topic: "t", cta: "Follow" });
    const yt = buildPublishedMetadata(plan, "youtube_shorts", { title: "A Different YouTube Title", captionBody: "a", hashtags: TAGS.slice(0, 4), topic: "t", cta: "Follow" });
    expect(tiktok.platform).toBe("tiktok");
    expect(yt.platform).toBe("youtube_shorts");
    expect(yt.title).not.toBe(tiktok.title);
  });
});

describe("serialization is stable and preserves null", () => {
  it("round-trips metadata with a fixed key order", () => {
    const meta = baseMeta();
    const json = JSON.parse(serializeMetadata(meta));
    expect(Object.keys(json)).toEqual(["platform", "title", "caption", "hashtags", "handlePlacement", "series", "topic", "hook", "cta", "durationSeconds", "voice", "visualStyle", "experimentId", "variationId", "publishedAt", "publishedUrl"]);
    expect(json.publishedAt).toBeNull();
  });

  it("never turns a missing metric into 0: emptyMetrics is all null, and serialization keeps it null", () => {
    const empty = emptyMetrics("2026-09-21T00:00:00.000Z");
    for (const field of METRIC_FIELDS) expect(empty[field]).toBeNull();
    const json = JSON.parse(serializeMetrics(empty));
    for (const field of METRIC_FIELDS) expect(json[field]).toBeNull();
  });

  it("metricsToRow maps every field and keeps null as null, never 0", () => {
    const metrics = emptyMetrics("2026-09-21T00:00:00.000Z");
    metrics.views = 500;
    const row = metricsToRow("meta-1", metrics);
    expect(row.views).toBe(500);
    expect(row.likes).toBeNull();
    expect(row.average_view_duration_seconds).toBeNull();
    expect(row.followers_gained).toBeNull();
  });
});

describe("CSV parsing: never invents zero for a missing metric", () => {
  it("splits quoted CSV correctly", () => {
    expect(splitCsv('a,"b,c",d\n1,2,3')).toEqual([["a", "b,c", "d"], ["1", "2", "3"]]);
  });

  it("parses views, watch time as mm:ss, and percentages", () => {
    expect(parseMetricCell("301", "views")).toBe(301);
    expect(parseMetricCell("1.2k", "views")).toBe(1200);
    expect(parseMetricCell("0:02", "averageViewDurationSeconds")).toBe(2);
    expect(parseMetricCell("1:30", "averageViewDurationSeconds")).toBe(90);
    expect(parseMetricCell("71.1%", "percentageViewed")).toBe(71.1);
    expect(parseMetricCell("113.2%", "percentageViewed")).toBe(113.2);
  });

  it('treats "N/A", empty, and a dash as not-reported (null), never 0', () => {
    for (const raw of ["", "N/A", "n/a", "-", "--"]) expect(parseMetricCell(raw, "likes")).toBeNull();
  });

  it("rejects an unparseable cell rather than guessing", () => {
    expect(parseMetricCell("about a lot", "views")).toBeUndefined();
    expect(parseMetricCell("150%", "completionRatePct")).toBeUndefined();
  });

  it("a full CSV import leaves unreported columns null, and reports bad cells by line instead of skipping silently", () => {
    const csv = ["platform,experiment_id,variation_id,views,likes,average_view_duration", "tiktok,exp-1,v-a,301,5,0:02", "youtube_shorts,exp-1,v-a,not-a-number,2,0:05"].join("\n");
    const { rows, errors } = parseMetricsCsv(csv, "2026-09-21T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metrics.views).toBe(301);
    expect(rows[0]!.metrics.likes).toBe(5);
    expect(rows[0]!.metrics.completionRatePct).toBeNull();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(3);
  });

  it("requires platform, experiment_id and variation_id columns", () => {
    const { errors } = parseMetricsCsv("views\n301", "2026-09-21T00:00:00.000Z");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("round-trips through serializeMetricsCsv with empty cells for null metrics", () => {
    const metrics = emptyMetrics("2026-09-21T00:00:00.000Z");
    metrics.views = 100;
    const csv = serializeMetricsCsv([{ platform: "tiktok", experimentId: "exp-1", variationId: "v-a", metrics }]);
    expect(csv).toContain("tiktok,exp-1,v-a");
    const { rows } = parseMetricsCsv(csv, "2026-09-21T00:00:00.000Z");
    expect(rows[0]!.metrics.views).toBe(100);
    expect(rows[0]!.metrics.likes).toBeNull();
  });
});

describe("performance repository: save then import", () => {
  it("refuses to save invalid metadata", async () => {
    const repo = new InMemoryVideoPerformanceRepository();
    await expect(saveMetadata(repo, baseMeta({ hashtags: [] }))).rejects.toThrow();
  });

  it("imports metrics only for a video whose metadata was already saved, and reports the rest", async () => {
    const repo = new InMemoryVideoPerformanceRepository();
    await saveMetadata(repo, baseMeta());
    const csv = ["platform,experiment_id,variation_id,views", `tiktok,${baseMeta().experimentId},${baseMeta().variationId},301`, "tiktok,unknown-exp,v-z,50"].join("\n");
    const summary = await importMetricsCsv(repo, csv);
    expect(summary.imported).toBe(1);
    expect(summary.errors.some((e) => e.message.includes("Save the video's metadata first"))).toBe(true);
    expect(repo.metrics[0]!.metrics.views).toBe(301);
    expect(repo.metrics[0]!.metrics.likes).toBeNull();
  });
});
