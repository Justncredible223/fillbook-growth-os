import { describe, it, expect } from "vitest";
import { computeInboundSummary } from "../src/inbound/inboundHandlers";
import type { InboundEngagement } from "../src/inbound/types";

function item(overrides: Partial<InboundEngagement>): InboundEngagement {
  return {
    id: "1",
    platform: "x",
    externalId: "1",
    conversationId: null,
    inReplyToExternalId: null,
    authorHandle: "someone",
    authorExternalId: "author-1",
    creatorId: null,
    body: "text",
    inResponseToText: null,
    publicMetrics: {},
    priority: "p3_comment",
    status: "needs_response",
    draftResponse: null,
    draftUsesLink: null,
    respondedAt: null,
    respondedNote: null,
    isRepeatEngager: false,
    observedAt: "2026-09-01T12:00:00Z",
    sourceReference: null,
    createdAt: "2026-09-01T12:00:00Z",
    updatedAt: "2026-09-01T12:00:00Z",
    ...overrides,
  };
}

const now = new Date("2026-09-02T12:00:00Z");

describe("computeInboundSummary", () => {
  it("counts review_needed toward needsResponse -- regression for a real bug found against production data", () => {
    const summary = computeInboundSummary([item({ status: "review_needed" })], now);
    expect(summary.needsResponse).toBe(1);
  });

  it("counts draft_ready toward needsResponse -- a draft is not a response, so it must not read as resolved", () => {
    const summary = computeInboundSummary([item({ status: "draft_ready", draftResponse: "a draft" })], now);
    expect(summary.needsResponse).toBe(1);
  });

  it("does NOT count responded or closed toward needsResponse", () => {
    const summary = computeInboundSummary(
      [item({ id: "1", externalId: "1", status: "responded" }), item({ id: "2", externalId: "2", status: "closed" })],
      now,
    );
    expect(summary.needsResponse).toBe(0);
  });

  it("counts follow_up separately from needsResponse", () => {
    const summary = computeInboundSummary([item({ status: "follow_up" })], now);
    expect(summary.needsResponse).toBe(0);
    expect(summary.followUp).toBe(1);
  });

  it("counts repeat engagers regardless of status, as long as they're in the active set passed in", () => {
    const summary = computeInboundSummary([item({ status: "needs_response", isRepeatEngager: true })], now);
    expect(summary.repeatEngagers).toBe(1);
  });

  it("flags an unresolved item older than 48h as overdue, but not a recent one", () => {
    const old = item({ id: "1", externalId: "1", status: "needs_response", observedAt: "2026-08-30T00:00:00Z" }); // 60h before `now`
    const recent = item({ id: "2", externalId: "2", status: "needs_response", observedAt: "2026-09-02T06:00:00Z" }); // 6h before `now`

    const summary = computeInboundSummary([old, recent], now);

    expect(summary.overdue).toBe(1);
  });

  it("never counts an already-resolved item as overdue, no matter how old", () => {
    const summary = computeInboundSummary(
      [item({ status: "responded", observedAt: "2026-01-01T00:00:00Z" })],
      now,
    );
    expect(summary.overdue).toBe(0);
  });

  it("returns all zeros for an empty active set -- an empty queue is a real state, not an error", () => {
    expect(computeInboundSummary([], now)).toEqual({ needsResponse: 0, followUp: 0, repeatEngagers: 0, overdue: 0 });
  });
});
