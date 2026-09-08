import { describe, it, expect } from "vitest";
import {
  normalizeVideoTopic,
  validateVideoTopicShape,
  manualVideoTopicTitle,
  manualVideoTopicOpportunityInput,
  MANUAL_VIDEO_TOPIC_TITLE_PREFIX,
  MIN_VIDEO_TOPIC_LENGTH,
  MAX_VIDEO_TOPIC_LENGTH,
} from "../src/opportunities/manualVideoTopic";

describe("normalizeVideoTopic", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeVideoTopic("  trailing   drawdown   rules  ")).toBe("trailing drawdown rules");
  });
});

describe("validateVideoTopicShape", () => {
  it("accepts a reasonable topic", () => {
    expect(validateVideoTopicShape("Trailing drawdown confuses new funded traders")).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(validateVideoTopicShape(123)).not.toBeNull();
    expect(validateVideoTopicShape(null)).not.toBeNull();
    expect(validateVideoTopicShape(undefined)).not.toBeNull();
  });

  it("rejects a topic shorter than the minimum length", () => {
    const result = validateVideoTopicShape("ab");
    expect(result).not.toBeNull();
    expect(result?.reason).toContain(String(MIN_VIDEO_TOPIC_LENGTH));
  });

  it("rejects a topic longer than the maximum length", () => {
    const result = validateVideoTopicShape("x".repeat(MAX_VIDEO_TOPIC_LENGTH + 1));
    expect(result).not.toBeNull();
    expect(result?.reason).toContain(String(MAX_VIDEO_TOPIC_LENGTH));
  });

  it("counts length after normalization, not the raw string -- excess whitespace alone shouldn't reject or falsely pass", () => {
    // "ab" alone is too short, but padded with only whitespace it's still
    // too short after normalization -- proves length is checked against
    // the normalized form, not the raw (whitespace-inflated) length.
    expect(validateVideoTopicShape("  ab  ")).not.toBeNull();
  });
});

describe("manualVideoTopicTitle", () => {
  it("prefixes the normalized topic", () => {
    expect(manualVideoTopicTitle("trailing drawdown rules")).toBe(`${MANUAL_VIDEO_TOPIC_TITLE_PREFIX}trailing drawdown rules`);
  });

  it("produces the identical canonical title for topics that differ only in whitespace/casing-insensitive comparison intent", () => {
    // manualVideoTopicTitle itself preserves case (the duplicate check in
    // api/run-campaign.ts does the case-insensitive comparison via ILIKE),
    // but whitespace normalization happens here regardless.
    const a = manualVideoTopicTitle("  trailing   drawdown  rules ");
    const b = manualVideoTopicTitle("trailing drawdown rules");
    expect(a).toBe(b);
  });
});

describe("manualVideoTopicOpportunityInput", () => {
  it("builds a well-formed opportunity insert payload", () => {
    const input = manualVideoTopicOpportunityInput("trailing drawdown confuses new traders");

    expect(input.title).toBe(`${MANUAL_VIDEO_TOPIC_TITLE_PREFIX}trailing drawdown confuses new traders`);
    expect(input.score).toBe(100);
    expect(input.confidence).toBe(1);
    expect(input.urgency).toBe("normal");
    expect(input.approvalClass).toBe("EXTERNAL_DRAFT");
    expect(input.recommendedChannels).toEqual([]);
    expect(input.signalIds).toEqual([]);
    expect(input.rationale).toContain("trailing drawdown confuses new traders");
  });
});
