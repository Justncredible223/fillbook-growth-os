import { describe, it, expect } from "vitest";
import { classifyPriority, isLowValue } from "../src/inbound/inboundClassifier";

describe("isLowValue", () => {
  it("treats empty/whitespace text as low value", () => {
    expect(isLowValue("")).toBe(true);
    expect(isLowValue("   ")).toBe(true);
  });

  it("treats pure emoji as low value", () => {
    expect(isLowValue("🔥🔥🔥")).toBe(true);
    expect(isLowValue("😂")).toBe(true);
  });

  it("treats a single low-effort hype word as low value", () => {
    expect(isLowValue("nice")).toBe(true);
    expect(isLowValue("Nice!")).toBe(true);
    expect(isLowValue("lol")).toBe(true);
  });

  it("does NOT treat a real question or comment as low value", () => {
    expect(isLowValue("how do you handle trailing drawdown on a 100k account?")).toBe(false);
    expect(isLowValue("this is exactly the problem I've had with my prop firm")).toBe(false);
  });

  it("does not treat an emoji alongside real text as low value", () => {
    expect(isLowValue("🔥 great point about position sizing, never thought of it that way")).toBe(false);
  });
});

describe("classifyPriority", () => {
  const base = { text: "some real comment about trading", isDirectReplyToUs: false, isQuotePost: false, hasExistingRelationship: false };

  it("classifies low-value text as low_value regardless of other signals", () => {
    expect(classifyPriority({ ...base, text: "🔥", isDirectReplyToUs: true, hasExistingRelationship: true })).toBe("low_value");
  });

  it("classifies an existing relationship as p2 even when it's not technically a direct reply", () => {
    expect(classifyPriority({ ...base, hasExistingRelationship: true, isDirectReplyToUs: false })).toBe("p2_relationship");
  });

  it("relationship outranks direct-reply -- who it's from matters more than the reply mechanics", () => {
    expect(classifyPriority({ ...base, hasExistingRelationship: true, isDirectReplyToUs: true })).toBe("p2_relationship");
  });

  it("classifies a direct reply to us (no relationship) as p1", () => {
    expect(classifyPriority({ ...base, isDirectReplyToUs: true })).toBe("p1_direct_reply");
  });

  it("classifies a quote post (no relationship, not a direct reply) as p4", () => {
    expect(classifyPriority({ ...base, isQuotePost: true })).toBe("p4_mention");
  });

  it("classifies a standalone mention containing a question as p3", () => {
    expect(classifyPriority({ ...base, text: "does fillbook support prop firm accounts?" })).toBe("p3_comment");
  });

  it("classifies a standalone mention with no question as p4", () => {
    expect(classifyPriority({ ...base, text: "just saw @FillbookHQ mentioned in a thread" })).toBe("p4_mention");
  });
});
