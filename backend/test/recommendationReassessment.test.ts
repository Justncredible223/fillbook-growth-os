import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { reassessStoredRecommendations } from "../src/partnerships/recommendationReassessment";

function row(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? "p1",
    organization_name: "Example",
    partner_category: "prop_firm",
    stage: "qualified",
    evidence_excerpts: [],
    discovered_via: "x_search",
    approved_campaign_asset_id: null,
    suppressed_reason: null,
    follow_up_count: 0,
    social_links: {},
    source_urls: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function client(rows: Record<string, any>[]) {
  return new FakeSupabaseClient({ partnership_prospects: rows });
}

describe("reassessStoredRecommendations", () => {
  it("suppresses a qualified, auto-discovered prospect whose evidence shows no concrete partnership basis -- real 'pijat jogja' shape", async () => {
    const c = client([
      row({
        id: "pijat-jogja",
        organization_name: "pijat jogja",
        evidence_excerpts: ["Honestly, my experience with Trusteed Prop Firm has been really positive so far. As a trader, I value more than just profits."],
      }),
    ]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]!.organizationName).toBe("pijat jogja");
    const updated = c.tables.partnership_prospects!.find((r) => r.id === "pijat-jogja")!;
    expect(updated.suppressed_reason).toContain("No evidence this recipient runs or offers");
    // Reversible and non-destructive -- stage and history untouched.
    expect(updated.stage).toBe("qualified");
  });

  it("leaves a genuine educator/coach untouched -- real Dan Cheung shape", async () => {
    const c = client([
      row({
        id: "dan-cheung",
        organization_name: "Dan Cheung",
        evidence_excerpts: ["Trading-journal/risk-management educator. Journaling / journal-review discussions -- directly the product's core format."],
      }),
    ]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(0);
    const updated = c.tables.partnership_prospects!.find((r) => r.id === "dan-cheung")!;
    expect(updated.suppressed_reason).toBeNull();
  });

  it("reactivates a previously-suppressed prospect once its evidence is updated to show a real partnership basis", async () => {
    const c = client([
      row({
        id: "p1",
        evidence_excerpts: ["My experience with this platform was fine."],
        suppressed_reason: "No evidence this recipient runs or offers...",
      }),
    ]);
    // Evidence gets updated with real ownership language (e.g. after
    // owner research or a fresh discovery enrichment pass).
    c.tables.partnership_prospects![0]!.evidence_excerpts = ["I coach a small cohort of futures traders every week."];
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.reactivated).toHaveLength(1);
    const updated = c.tables.partnership_prospects!.find((r) => r.id === "p1")!;
    expect(updated.suppressed_reason).toBeNull();
  });

  it("NEVER touches an archived prospect, even with unsupported evidence", async () => {
    const c = client([row({ id: "p1", stage: "archived", evidence_excerpts: ["random unrelated text"] })]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(c.tables.partnership_prospects![0]!.suppressed_reason).toBeNull();
  });

  it("NEVER touches a do_not_contact prospect", async () => {
    const c = client([row({ id: "p1", stage: "do_not_contact", evidence_excerpts: ["random unrelated text"] })]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.skipped).toBe(1);
    expect(c.tables.partnership_prospects![0]!.suppressed_reason).toBeNull();
  });

  it("NEVER touches a prospect already contacted/replied/pilot/active_partner/closed -- reassessment only applies before outreach", async () => {
    const c = client(["contacted", "replied", "pilot", "active_partner", "closed"].map((stage, i) => row({ id: `p${i}`, stage, evidence_excerpts: ["unrelated"] })));
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(0);
    expect(result.skipped).toBe(5);
  });

  it("NEVER touches a prospect with an already-approved draft -- a passing 9-reviewer draft is stronger evidence than this heuristic", async () => {
    const c = client([row({ id: "p1", stage: "draft_ready", approved_campaign_asset_id: "asset-1", evidence_excerpts: ["unrelated text with no ownership language"] })]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("NEVER touches a manually created-and-qualified prospect -- that's the owner's own judgment call, not this reassessment's to override", async () => {
    const c = client([row({ id: "p1", discovered_via: "manual", evidence_excerpts: ["unrelated text with no ownership language"] })]);
    const result = await reassessStoredRecommendations(asSupabase(c));
    expect(result.suppressed).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it("is idempotent -- running it twice in a row doesn't re-suppress or double-count", async () => {
    const c = client([row({ id: "p1", evidence_excerpts: ["unrelated text"] })]);
    await reassessStoredRecommendations(asSupabase(c));
    const second = await reassessStoredRecommendations(asSupabase(c));
    expect(second.suppressed).toHaveLength(0); // already suppressed, nothing new to do
  });
});
