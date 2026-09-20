import { describe, it, expect } from "vitest";
import { computeGrowthLoopSummary, type GrowthLoopInput } from "../src/attribution/growthLoopAnalytics";

const base: GrowthLoopInput = {
  windowDays: 7,
  publications: [],
  linkClickCount: 0,
  conversions: [],
  contentProductionCostUsd: 0,
  fillbookSyncHasEverDelivered: false,
};

describe("computeGrowthLoopSummary", () => {
  it("counts only publications with a real owner-confirmed timestamp, not placeholder rows holding just a destination link", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      publications: [
        { channel: "x", ownerReportedPublishedAt: "2026-09-15T00:00:00Z" },
        { channel: "youtube", ownerReportedPublishedAt: null }, // placeholder, destination link only
      ],
    });
    expect(result.publishedContentCount).toBe(1);
  });

  it("counts signups, activated, and first-paid separately by event_type", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      conversions: [
        { eventType: "signup", utmSource: "x", occurredAt: "t" },
        { eventType: "signup", utmSource: "x", occurredAt: "t" },
        { eventType: "activation", utmSource: "x", occurredAt: "t" },
        { eventType: "first_paid", utmSource: "x", occurredAt: "t" },
      ],
    });
    expect(result.signups).toBe(2);
    expect(result.activated).toBe(1);
    expect(result.firstPaidConversions).toBe(1);
  });

  it("labels link clicks explicitly, never as 'visitors'", () => {
    const result = computeGrowthLoopSummary({ ...base, linkClickCount: 42 });
    expect(result.trackedLinkClicks).toBe(42);
    expect(result.attributionNote.toLowerCase()).toContain("attributable visits only");
  });

  it("reports funnelConnectionStatus as not_yet_connected when nothing has EVER arrived, distinct from a genuinely-zero window", () => {
    const result = computeGrowthLoopSummary({ ...base, fillbookSyncHasEverDelivered: false });
    expect(result.funnelConnectionStatus).toBe("not_yet_connected");
    expect(result.signups).toBe(0);
  });

  it("reports funnelConnectionStatus as connected when the sync has delivered before, even if this window is zero", () => {
    const result = computeGrowthLoopSummary({ ...base, fillbookSyncHasEverDelivered: true });
    expect(result.funnelConnectionStatus).toBe("connected");
    expect(result.signups).toBe(0);
  });

  it("never computes cost-per-signup when signups is zero -- null, not Infinity/NaN, and never a misleading rate", () => {
    const result = computeGrowthLoopSummary({ ...base, contentProductionCostUsd: 12.5, conversions: [] });
    expect(result.costPerSignup).toBeNull();
  });

  it("computes a real cost-per-signup when the denominator is real", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      contentProductionCostUsd: 10,
      conversions: [
        { eventType: "signup", utmSource: "x", occurredAt: "t" },
        { eventType: "signup", utmSource: "x", occurredAt: "t" },
      ],
    });
    expect(result.costPerSignup).toBe(5);
  });

  it("always reports active subscriptions as unavailable, with an honest reason, never fabricated from first-paid counts", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      conversions: [{ eventType: "first_paid", utmSource: "x", occurredAt: "t" }],
    });
    expect(result.activeSubscriptions.status).toBe("unavailable");
    expect(result.activeSubscriptions.reason).toContain("isolated");
  });

  it("breaks down publications and every event type by channel (utm_source / platform)", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      publications: [
        { channel: "x", ownerReportedPublishedAt: "t" },
        { channel: "youtube", ownerReportedPublishedAt: "t" },
      ],
      conversions: [
        { eventType: "signup", utmSource: "x", occurredAt: "t" },
        { eventType: "signup", utmSource: "youtube", occurredAt: "t" },
        { eventType: "activation", utmSource: "x", occurredAt: "t" },
      ],
    });
    const x = result.byChannel.find((c) => c.channel === "x")!;
    const youtube = result.byChannel.find((c) => c.channel === "youtube")!;
    expect(x).toMatchObject({ publishedContentCount: 1, signups: 1, activated: 1, firstPaidConversions: 0 });
    expect(youtube).toMatchObject({ publishedContentCount: 1, signups: 1, activated: 0 });
  });

  it("excludes conversions with no utm_source from the channel breakdown rather than inventing a channel for them", () => {
    const result = computeGrowthLoopSummary({
      ...base,
      conversions: [{ eventType: "signup", utmSource: null, occurredAt: "t" }],
    });
    expect(result.byChannel).toHaveLength(0);
    expect(result.signups).toBe(1); // still counted in the aggregate total, just not attributable to a channel
  });

  it("passes through windowDays and rounds contentProductionCostUsd", () => {
    const result = computeGrowthLoopSummary({ ...base, windowDays: 30, contentProductionCostUsd: 1.23456789 });
    expect(result.windowDays).toBe(30);
    expect(result.contentProductionCostUsd).toBe(1.234568);
  });
});
