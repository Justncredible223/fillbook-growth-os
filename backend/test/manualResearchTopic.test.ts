import { describe, it, expect } from "vitest";
import {
  normalizeResearchTopic,
  validateResearchTopicShape,
  manualResearchTopicTitle,
  manualResearchTopicOpportunityInput,
  MANUAL_RESEARCH_TOPIC_TITLE_PREFIX,
  MIN_RESEARCH_TOPIC_LENGTH,
  MAX_RESEARCH_TOPIC_LENGTH,
} from "../src/opportunities/manualResearchTopic";

describe("normalizeResearchTopic", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeResearchTopic("  trailing   drawdown   rules  ")).toBe("trailing drawdown rules");
  });
});

describe("validateResearchTopicShape", () => {
  it("accepts a reasonable topic", () => {
    expect(validateResearchTopicShape("Do prop-firm traders understand trailing drawdown rules?")).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(validateResearchTopicShape(123)).not.toBeNull();
    expect(validateResearchTopicShape(null)).not.toBeNull();
    expect(validateResearchTopicShape(undefined)).not.toBeNull();
  });

  it("rejects a topic shorter than the minimum length", () => {
    const result = validateResearchTopicShape("ab");
    expect(result).not.toBeNull();
    expect(result?.reason).toContain(String(MIN_RESEARCH_TOPIC_LENGTH));
  });

  it("rejects a topic longer than the maximum length", () => {
    const result = validateResearchTopicShape("x".repeat(MAX_RESEARCH_TOPIC_LENGTH + 1));
    expect(result).not.toBeNull();
    expect(result?.reason).toContain(String(MAX_RESEARCH_TOPIC_LENGTH));
  });

  it("counts length after normalization, not the raw string -- excess whitespace alone shouldn't reject or falsely pass", () => {
    expect(validateResearchTopicShape("  ab  ")).not.toBeNull();
  });
});

describe("manualResearchTopicTitle", () => {
  it("prefixes the normalized topic", () => {
    expect(manualResearchTopicTitle("trailing drawdown rules")).toBe(`${MANUAL_RESEARCH_TOPIC_TITLE_PREFIX}trailing drawdown rules`);
  });

  it("produces the identical canonical title for topics that differ only in whitespace", () => {
    const a = manualResearchTopicTitle("  trailing   drawdown  rules ");
    const b = manualResearchTopicTitle("trailing drawdown rules");
    expect(a).toBe(b);
  });
});

describe("manualResearchTopicOpportunityInput", () => {
  it("builds a well-formed opportunity insert payload", () => {
    const input = manualResearchTopicOpportunityInput("do funded traders understand trailing drawdown");

    expect(input.title).toBe(`${MANUAL_RESEARCH_TOPIC_TITLE_PREFIX}do funded traders understand trailing drawdown`);
    expect(input.score).toBe(100);
    expect(input.confidence).toBe(1);
    expect(input.urgency).toBe("normal");
    expect(input.approvalClass).toBe("EXTERNAL_DRAFT");
    expect(input.recommendedChannels).toEqual([]);
    expect(input.signalIds).toEqual([]);
    expect(input.rationale).toContain("do funded traders understand trailing drawdown");
  });
});
