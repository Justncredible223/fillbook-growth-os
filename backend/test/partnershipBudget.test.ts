import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { evaluatePartnershipBudget, getPartnershipMonthSpendUsd, PARTNERSHIP_MONTHLY_BUDGET_USD } from "../src/partnerships/budget";

describe("evaluatePartnershipBudget", () => {
  it("is eligible when under the cap", () => {
    expect(evaluatePartnershipBudget(0, 3.0)).toEqual({ eligible: true });
    expect(evaluatePartnershipBudget(2.99, 3.0)).toEqual({ eligible: true });
  });

  it("is ineligible once spend reaches or exceeds the cap, with the real numbers in the reason", () => {
    const result = evaluatePartnershipBudget(3.0, 3.0);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/monthly_budget_reached/);
    expect(result.reason).toContain("3.00");
  });

  it("is ineligible and clearly labeled 'disabled' when the budget itself is 0 or negative -- distinct from a genuinely exhausted budget", () => {
    const result = evaluatePartnershipBudget(0, 0);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/partnership_budget_disabled/);
  });

  it("PARTNERSHIP_MONTHLY_BUDGET_USD defaults to a real, positive, owner-approved value (not silently 0)", () => {
    expect(PARTNERSHIP_MONTHLY_BUDGET_USD).toBeGreaterThan(0);
  });
});

describe("getPartnershipMonthSpendUsd -- independent of every other feature's budget line", () => {
  it("sums only 'partnership_llm_call' events within the current calendar month, ignoring other event_types and other months", async () => {
    const now = new Date("2026-09-15T12:00:00Z");
    const client = new FakeSupabaseClient({
      cost_events: [
        { event_type: "partnership_llm_call", cost_usd: 0.08, created_at: "2026-09-01T00:00:00Z" },
        { event_type: "partnership_llm_call", cost_usd: 0.05, created_at: "2026-09-10T00:00:00Z" },
        { event_type: "x_search_read", cost_usd: 100, created_at: "2026-09-05T00:00:00Z" }, // Prospecting's own event_type -- must not leak in
        { event_type: "llm_call", cost_usd: 100, created_at: "2026-09-05T00:00:00Z" }, // auto-draft/x-feed-post's generic llm_call -- must not leak in
        { event_type: "partnership_llm_call", cost_usd: 100, created_at: "2026-08-31T23:59:59Z" }, // last month -- excluded
      ],
    });

    const spend = await getPartnershipMonthSpendUsd(asSupabase(client), now);

    expect(spend).toBeCloseTo(0.13);
  });

  it("propagates a real query error rather than silently returning 0", async () => {
    const client = new FakeSupabaseClient({});
    client.failTable("cost_events", { message: "connection refused" });
    await expect(getPartnershipMonthSpendUsd(asSupabase(client))).rejects.toThrow(/getPartnershipMonthSpendUsd failed/);
  });
});
