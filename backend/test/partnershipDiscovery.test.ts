import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { runPartnershipDiscoveryStep } from "../src/partnerships/discovery";
import type { XSignalAdapter, XSearchResult } from "../src/signals/adapters/xAdapter";

function fakeAdapter(resultsByQuery: Record<string, XSearchResult[]>): XSignalAdapter {
  return {
    searchRecentPosts: async (query: string) => resultsByQuery[query] ?? [],
  } as unknown as XSignalAdapter;
}

function xResult(overrides: Partial<XSearchResult> = {}): XSearchResult {
  return {
    id: "1",
    text: "I'm a futures trading coach helping traders build a real journaling habit.",
    authorId: "u1",
    authorHandle: "coachdana",
    authorName: "Dana",
    authorFollowerCount: 500,
    authorVerified: false,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    publicMetrics: null,
    lang: "en",
    ...overrides,
  };
}

const NOW = new Date("2026-09-05T00:00:00Z");

describe("runPartnershipDiscoveryStep", () => {
  it("finds a new candidate via X search, dedupes against nothing, and creates it as an already-qualified, evidence-backed prospect (no send, no contact)", async () => {
    const client = new FakeSupabaseClient({ creators: [], prospecting_candidates: [], inbound_engagements: [], partnership_prospects: [], cost_events: [] });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.status).toBe("found");
    expect(result.newCandidates).toBe(1);
    expect(result.costUsd).toBeGreaterThan(0);

    const created = client.tables.partnership_prospects!;
    expect(created).toHaveLength(1);
    expect(created[0]!.stage).toBe("qualified");
    expect(created[0]!.discovered_via).toBe("x_search");
    expect(created[0]!.discovery_score).toBeGreaterThan(0);
    expect(created[0]!.contacted_at).toBeNull();
    expect(created[0]!.approved_campaign_asset_id).toBeNull();
  });

  it("surfaces a qualifying-but-thin-evidence candidate as a plain 'prospect' (not 'qualified'), never presented as ready to pitch, when no adapter is available to enrich it", async () => {
    const client = new FakeSupabaseClient({ creators: [], prospecting_candidates: [], inbound_engagements: [], partnership_prospects: [], cost_events: [] });
    // "prop firm" alone matches a keyword but is far too short to personalize a pitch with.
    const adapter = fakeAdapter({ "prop firm mentorship OR funded trader program": [xResult({ authorHandle: "thinacct", text: "prop firm" })] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.newCandidates).toBe(1);
    const created = client.tables.partnership_prospects![0]!;
    expect(created.stage).toBe("prospect");
    expect(created.qualification_rationale).toBeNull();
    expect(created.futures_relevance_evidence).toContain("Needs manual research");
  });

  it("enriches a thin candidate with a per-handle lookup and qualifies it once real content is found", async () => {
    const client = new FakeSupabaseClient({ creators: [], prospecting_candidates: [], inbound_engagements: [], partnership_prospects: [], cost_events: [] });
    const adapter = fakeAdapter({
      "prop firm mentorship OR funded trader program": [xResult({ authorHandle: "thinacct", text: "prop firm" })],
      "from:thinacct": [xResult({ authorHandle: "thinacct", text: "Running a funded-trader mentorship cohort this quarter -- 12 traders, weekly risk reviews, real accountability." })],
    });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.newCandidates).toBe(1);
    expect(result.sourcesSearched).toContain("x_search_enrichment");
    const created = client.tables.partnership_prospects![0]!;
    expect(created.stage).toBe("qualified");
    expect(created.qualification_rationale).toContain("mentorship cohort");
  });

  it("never duplicates a candidate already known in partnership_prospects (idempotent re-run)", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [{ id: "existing-1", organization_name: "Dana", normalized_handle: "coachdana", normalized_domain: null, stage: "qualified" }],
      cost_events: [],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.newCandidates).toBe(0);
    expect(client.tables.partnership_prospects).toHaveLength(1); // still just the pre-existing row
  });

  it("a real end-to-end re-run (via the actual createPartnership path, not a hand-seeded fixture) never duplicates the same candidate -- regression test for a real production bug where normalizeHandle stored a full URL while discovery's own pre-insert check compared against the bare handle", async () => {
    const client = new FakeSupabaseClient({ creators: [], prospecting_candidates: [], inbound_engagements: [], partnership_prospects: [], cost_events: [] });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const first = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });
    expect(first.newCandidates).toBe(1);

    const oneHourLater = new Date(NOW.getTime() + 61 * 60 * 1000);
    const second = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: oneHourLater });

    expect(second.newCandidates).toBe(0);
    expect(client.tables.partnership_prospects).toHaveLength(1); // still just the one real row from the first run
  });

  it("never re-surfaces a candidate that was already archived or marked do-not-contact", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [{ id: "existing-1", organization_name: "Dana", normalized_handle: "coachdana", normalized_domain: null, stage: "do_not_contact" }],
      cost_events: [],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.newCandidates).toBe(0);
  });

  it("is skipped (not run) once the partnership monthly budget is already exhausted, and this is distinguishable from a genuine zero-matches run", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      cost_events: [{ event_type: "partnership_llm_call", cost_usd: 3.5, created_at: NOW.toISOString() }],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.status).toBe("budget_exhausted");
    expect(result.newCandidates).toBe(0);
    expect(client.tables.partnership_prospects).toHaveLength(0);
  });

  it("budget exhaustion for Partnerships never blocks or is affected by Prospecting's separate x_search_read spend", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      // A huge amount of PROSPECTING spend (different event_type) -- must not count against Partnerships' budget.
      cost_events: [{ event_type: "x_search_read", cost_usd: 999, created_at: NOW.toISOString() }],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.status).not.toBe("budget_exhausted");
  });

  it("respects the minimum-interval gate even when force:true is passed (a rapid double-tap can't double-spend)", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      cost_events: [],
      partnership_discovery_runs: [{ id: "run-1", created_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString() }],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.status).toBe("skipped_cadence");
    expect(result.skipReason).toContain("minimum interval");
  });

  it("a SCHEDULED (unforced) run is skipped if the last run was within the 7-day cadence, without touching budget or creating candidates", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      cost_events: [],
      partnership_discovery_runs: [{ id: "run-1", created_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() }],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "scheduled", now: NOW });

    expect(result.status).toBe("skipped_cadence");
    expect(result.newCandidates).toBe(0);
  });

  it("an owner-triggered force:true run proceeds even inside the 7-day scheduled cadence (once the minimum interval has passed)", async () => {
    const client = new FakeSupabaseClient({
      creators: [],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      cost_events: [],
      partnership_discovery_runs: [{ id: "run-1", created_at: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString() }],
    });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    expect(result.status).toBe("found");
  });

  it("works with existing-records sources alone when no X adapter is available (e.g. credentials unset) -- reduced discovery, not a hard failure", async () => {
    const client = new FakeSupabaseClient({
      creators: [{ id: "c1", handle: "coachdana", display_name: "Dana", platform: "x", category: "tier_b", notes: "Runs a trading coach program with journaling focus", creator_product_moment: null, last_interaction_at: "2026-09-01T00:00:00Z" }],
      prospecting_candidates: [],
      inbound_engagements: [],
      partnership_prospects: [],
      cost_events: [],
    });

    const result = await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter: null, triggeredBy: "owner", force: true, now: NOW });

    expect(result.sourcesSearched).not.toContain("x_search");
    expect(result.costUsd).toBe(0);
  });

  it("never marks any created prospect as contacted or generates a pitch draft -- discovery only qualifies, outreach stays a fully separate later action", async () => {
    const client = new FakeSupabaseClient({ creators: [], prospecting_candidates: [], inbound_engagements: [], partnership_prospects: [], cost_events: [] });
    const adapter = fakeAdapter({ "futures trading coach OR trading mentor": [xResult()] });

    await runPartnershipDiscoveryStep({ client: asSupabase(client), adapter, triggeredBy: "owner", force: true, now: NOW });

    const created = client.tables.partnership_prospects!;
    expect(created[0]!.stage).not.toBe("contacted");
    expect(created[0]!.contacted_at).toBeNull();
    expect(created[0]!.approved_campaign_asset_id).toBeNull();
  });
});
