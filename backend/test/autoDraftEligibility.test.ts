import { describe, it, expect } from "vitest";
import {
  filterEligibleOpportunities,
  selectBestQualifyingOpportunity,
  evaluateBacklog,
  evaluateMonthlyBudget,
  isStale,
  MIN_QUALIFYING_SCORE,
  STALE_WINDOW_DAYS,
  BACKLOG_CAP,
  MONTHLY_AUTO_DRAFT_BUDGET_USD,
} from "../src/opportunities/autoDraftEligibility";
import type { Opportunity } from "../src/opportunities/types";

const now = new Date("2026-09-08T12:00:00Z");

function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    title: "Real signal",
    score: 60,
    urgency: "normal",
    confidence: 0.7,
    rationale: "real evidence",
    recommendedChannels: ["x"],
    recommendedCampaignType: null,
    approvalClass: "EXTERNAL_DRAFT",
    status: "open",
    signalIds: ["sig-1"],
    createdAt: new Date("2026-09-07T12:00:00Z"),
    ...overrides,
  };
}

describe("filterEligibleOpportunities / selectBestQualifyingOpportunity", () => {
  it("selects the single qualifying opportunity", () => {
    const opp = makeOpportunity({ score: MIN_QUALIFYING_SCORE + 1 });
    const result = selectBestQualifyingOpportunity([opp], new Set(), now);
    expect(result?.id).toBe(opp.id);
  });

  it("returns null when nothing qualifies -- 'no draft' is a correct result", () => {
    const weak = makeOpportunity({ score: MIN_QUALIFYING_SCORE - 1 });
    const result = selectBestQualifyingOpportunity([weak], new Set(), now);
    expect(result).toBeNull();
  });

  it("excludes opportunities below the score threshold", () => {
    const eligible = filterEligibleOpportunities([makeOpportunity({ score: MIN_QUALIFYING_SCORE - 0.01 })], new Set(), now);
    expect(eligible).toHaveLength(0);
  });

  it("excludes stale opportunities older than STALE_WINDOW_DAYS", () => {
    const stale = makeOpportunity({ createdAt: new Date(now.getTime() - (STALE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000) });
    expect(isStale(stale, now)).toBe(true);
    expect(filterEligibleOpportunities([stale], new Set(), now)).toHaveLength(0);
  });

  it("keeps an opportunity exactly at the freshness boundary as fresh", () => {
    const fresh = makeOpportunity({ createdAt: new Date(now.getTime() - (STALE_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000) });
    expect(isStale(fresh, now)).toBe(false);
  });

  it("excludes opportunities that already have a campaign (already-used)", () => {
    const opp = makeOpportunity({ id: "opp-used" });
    const eligible = filterEligibleOpportunities([opp], new Set(["opp-used"]), now);
    expect(eligible).toHaveLength(0);
  });

  it("picks the highest-scored eligible opportunity when multiple qualify (input pre-sorted, as listOpen() returns)", () => {
    const strong = makeOpportunity({ id: "strong", score: 90 });
    const weaker = makeOpportunity({ id: "weaker", score: 55 });
    // listOpen() always returns score-descending -- caller is responsible for the order.
    const result = selectBestQualifyingOpportunity([strong, weaker], new Set(), now);
    expect(result?.id).toBe("strong");
  });
});

describe("evaluateBacklog", () => {
  it("allows when below the cap", () => {
    expect(evaluateBacklog(BACKLOG_CAP - 1).eligible).toBe(true);
  });

  it("blocks at the cap", () => {
    const result = evaluateBacklog(BACKLOG_CAP);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("backlog_cap_reached");
  });

  it("blocks above the cap", () => {
    expect(evaluateBacklog(BACKLOG_CAP + 5).eligible).toBe(false);
  });
});

describe("evaluateMonthlyBudget", () => {
  it("allows when under budget", () => {
    expect(evaluateMonthlyBudget(MONTHLY_AUTO_DRAFT_BUDGET_USD - 0.01).eligible).toBe(true);
  });

  it("blocks at the budget ceiling (fail closed)", () => {
    const result = evaluateMonthlyBudget(MONTHLY_AUTO_DRAFT_BUDGET_USD);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("monthly_budget_reached");
  });
});
