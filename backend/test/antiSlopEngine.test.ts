import { describe, it, expect } from "vitest";
import { checkAntiSlop, isClean } from "../src/content/antiSlopEngine";

describe("antiSlopEngine", () => {
  it("flags a generic AI opener", () => {
    const findings = checkAntiSlop("In today's fast-paced trading world, journaling matters.");
    expect(findings.some((f) => f.rule === "generic_opener")).toBe(true);
  });

  it("flags AI cliche phrases", () => {
    const findings = checkAntiSlop("This feature is a total game changer for prop traders.");
    expect(findings.some((f) => f.rule === "ai_cliche_phrase")).toBe(true);
  });

  it("flags fake urgency", () => {
    const findings = checkAntiSlop("Act now, don't miss out on tracking your trades.");
    expect(findings.some((f) => f.rule === "fake_urgency")).toBe(true);
  });

  // Threshold is >= 6 (raised from 3 in f5717c8: a few em dashes across a
  // multi-section piece is natural; only a wall of them reads as AI slop).
  it("flags excessive em dashes", () => {
    const findings = checkAntiSlop(
      "Trading — like life — is hard — but journaling — done daily — helps — a lot."
    );
    expect(findings.some((f) => f.rule === "excessive_em_dashes")).toBe(true);
  });

  it("does not flag a handful of em dashes below the threshold", () => {
    const findings = checkAntiSlop("Trading — like life — is hard — but journaling helps.");
    expect(findings.some((f) => f.rule === "excessive_em_dashes")).toBe(false);
  });

  // Threshold is >= 10 (raised from 5 in f5717c8: the video script prompt asks
  // for 5-8 hashtags, so the old threshold failed every generated script).
  it("flags hashtag spam", () => {
    const findings = checkAntiSlop(
      "Great trade today #trading #futures #propfirm #daytrading #nq #es #ym #rty #cl #gc"
    );
    expect(findings.some((f) => f.rule === "hashtag_spam")).toBe(true);
  });

  it("does not flag a normal hashtag count below the threshold", () => {
    const findings = checkAntiSlop("Great trade today #trading #futures #propfirm #daytrading #nq #es");
    expect(findings.some((f) => f.rule === "hashtag_spam")).toBe(false);
  });

  it("passes genuinely clean, specific content", () => {
    expect(isClean("Most traders don't realize a -1R day can still contain three rule violations.")).toBe(true);
  });
});
