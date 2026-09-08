import { describe, it, expect } from "vitest";
import { estimateCostUsd, getProspectingMonthSpendUsd } from "../src/cost/costTracking";
import { FakeSupabaseClient } from "./helpers/fakeSupabase";

describe("estimateCostUsd", () => {
  it("computes cost from real per-million-token pricing", () => {
    const cost = estimateCostUsd({ model: "claude-sonnet-4-5-20250929", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it("scales linearly with token count", () => {
    const cost = estimateCostUsd({ model: "claude-sonnet-4-5-20250929", inputTokens: 100, outputTokens: 50 });
    expect(cost).toBeCloseTo((100 / 1_000_000) * 3 + (50 / 1_000_000) * 15, 9);
  });

  it("falls back to default pricing for an unrecognized model rather than throwing", () => {
    expect(() => estimateCostUsd({ model: "some-future-model", inputTokens: 10, outputTokens: 10 })).not.toThrow();
  });
});

describe("getProspectingMonthSpendUsd", () => {
  it("counts both x_search_read and prospecting_llm_call -- the reply-writer's own LLM cost must gate the same budget as its search cost", async () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const client = new FakeSupabaseClient({
      cost_events: [
        { event_type: "x_search_read", cost_usd: 0.05, created_at: "2026-09-01T00:00:00Z" },
        { event_type: "prospecting_llm_call", cost_usd: 0.01, created_at: "2026-09-02T00:00:00Z" },
        // A different feature's generic llm_call row in the same month must never be counted here.
        { event_type: "llm_call", cost_usd: 100, created_at: "2026-09-03T00:00:00Z" },
        // Outside the month -- must not be counted.
        { event_type: "prospecting_llm_call", cost_usd: 5, created_at: "2026-08-31T23:59:59Z" },
      ],
    });
    const spend = await getProspectingMonthSpendUsd(client as any, now);
    expect(spend).toBeCloseTo(0.06, 9);
  });
});
