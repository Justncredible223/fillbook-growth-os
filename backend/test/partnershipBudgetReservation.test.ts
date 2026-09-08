import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { reservePartnershipBudget, releasePartnershipBudgetReservation } from "../src/partnerships/budgetReservation";

function client(overrides: Record<string, any[]> = {}) {
  return new FakeSupabaseClient({ cost_events: [], partnership_budget_reservations: [], ...overrides });
}

describe("reservePartnershipBudget / releasePartnershipBudgetReservation", () => {
  it("reserves successfully when nothing has been spent, and the reservation shows up as an open row", async () => {
    const c = client();
    const result = await reservePartnershipBudget(asSupabase(c), "generation", 0.25, "prospect-1");
    expect(result.eligible).toBe(true);
    expect(result.reservationId).not.toBeNull();
    const open = c.tables.partnership_budget_reservations!.filter((r) => r.released_at == null);
    expect(open).toHaveLength(1);
    expect(open[0]!.bucket).toBe("generation");
    expect(open[0]!.prospect_id).toBe("prospect-1");
  });

  it("releasing stops the reservation from counting as open", async () => {
    const c = client();
    const { reservationId } = await reservePartnershipBudget(asSupabase(c), "generation", 0.25);
    await releasePartnershipBudgetReservation(asSupabase(c), reservationId);
    const open = c.tables.partnership_budget_reservations!.filter((r) => r.released_at == null);
    expect(open).toHaveLength(0);
  });

  it("releasing is idempotent -- calling it twice never double-releases or errors", async () => {
    const c = client();
    const { reservationId } = await reservePartnershipBudget(asSupabase(c), "generation", 0.25);
    await releasePartnershipBudgetReservation(asSupabase(c), reservationId);
    await expect(releasePartnershipBudgetReservation(asSupabase(c), reservationId)).resolves.not.toThrow();
  });

  it("releasing a null reservationId (nothing was ever reserved) is a safe no-op", async () => {
    const c = client();
    await expect(releasePartnershipBudgetReservation(asSupabase(c), null)).resolves.not.toThrow();
  });

  it("denies a reservation that would push its OWN bucket over the bucket cap, even with room left in the shared cap", async () => {
    const c = client({ cost_events: [{ event_type: "partnership_llm_call", cost_usd: 9.9, created_at: new Date().toISOString() }] });
    const result = await reservePartnershipBudget(asSupabase(c), "generation", 0.25); // 9.9 + 0.25 = 10.15 > $10.00 generation cap
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bucket_budget_reached \(generation/);
    expect(c.tables.partnership_budget_reservations).toHaveLength(0); // denied reservations are never inserted
  });

  it("real recorded spend in the OTHER bucket never counts against this bucket's cap", async () => {
    const c = client({ cost_events: [{ event_type: "partnership_x_search_read", cost_usd: 0.99, created_at: new Date().toISOString() }] });
    const result = await reservePartnershipBudget(asSupabase(c), "generation", 0.25);
    expect(result.eligible).toBe(true); // discovery's near-exhausted spend doesn't touch generation's own cap
  });

  it("two back-to-back reservations in the SAME bucket correctly stack against each other -- the second sees the first's still-open hold", async () => {
    const c = client({ cost_events: [{ event_type: "partnership_llm_call", cost_usd: 9.6, created_at: new Date().toISOString() }] }); // $0.40 headroom
    const first = await reservePartnershipBudget(asSupabase(c), "generation", 0.25); // 9.6+0.25=9.85 OK
    expect(first.eligible).toBe(true);
    const second = await reservePartnershipBudget(asSupabase(c), "generation", 0.25); // 9.6+0.25(open)+0.25=10.10 > 10.00
    expect(second.eligible).toBe(false);
    expect(second.reason).toMatch(/bucket_budget_reached/);
  });

  it("FIXED (was a real gap): an expired open reservation is SETTLED into a real, conservative charge -- it must count as spend, not silently free up budget for a call whose true cost is unknown", async () => {
    const oldReservation = { id: "old-1", bucket: "generation", amount_usd: 0.25, prospect_id: null, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), released_at: null, settled_as_charge: false }; // 10 minutes old, default expiry is 300s = 5min
    const c = client({
      cost_events: [{ event_type: "partnership_llm_call", cost_usd: 9.6, created_at: new Date().toISOString() }],
      partnership_budget_reservations: [oldReservation],
    });
    const result = await reservePartnershipBudget(asSupabase(c), "generation", 0.2);

    // Settlement inserted a real, conservative charge for the full ceiling
    // amount -- 9.6 (real) + 0.25 (settled) + 0.2 (requested) = 10.05 >
    // $10.00 generation cap, so this must now be DENIED, not approved.
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bucket_budget_reached/);

    const settledCharge = c.tables.cost_events!.find((r) => r.context?.settledReservationId === "old-1");
    expect(settledCharge).toBeDefined();
    expect(settledCharge!.cost_usd).toBe(0.25);
    expect(settledCharge!.event_type).toBe("partnership_llm_call");

    const oldRow = c.tables.partnership_budget_reservations!.find((r) => r.id === "old-1")!;
    expect(oldRow.released_at).not.toBeNull();
    expect(oldRow.settled_as_charge).toBe(true);
  });

  it("an expired reservation in the discovery bucket settles under the partnership_x_search_read event type", async () => {
    const oldReservation = { id: "old-2", bucket: "discovery", amount_usd: 0.275, prospect_id: null, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), released_at: null, settled_as_charge: false };
    const c = client({ partnership_budget_reservations: [oldReservation] });
    await reservePartnershipBudget(asSupabase(c), "discovery", 0.01);
    const settledCharge = c.tables.cost_events!.find((r) => r.context?.settledReservationId === "old-2");
    expect(settledCharge).toBeDefined();
    expect(settledCharge!.event_type).toBe("partnership_x_search_read");
  });

  it("release with hasConfirmedRealCost=true reverses an already-settled conservative charge -- the real recorded cost supersedes the estimate, never both", async () => {
    const c = client();
    const { reservationId } = await reservePartnershipBudget(asSupabase(c), "generation", 0.25, "prospect-1");
    // Simulate this reservation aging past the expiry window without its
    // owning request ever calling release (a timeout or a killed process).
    c.tables.partnership_budget_reservations![0]!.created_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    // A later, unrelated reserve call settles it as a side effect (exactly
    // as reserve_partnership_budget does in production).
    await reservePartnershipBudget(asSupabase(c), "generation", 0.01, "prospect-2");
    expect(c.tables.cost_events!.find((r) => r.context?.settledReservationId === reservationId)).toBeDefined();

    // The original request eventually DOES finish and confirms real cost
    // was recorded for its attempt.
    c.tables.cost_events!.push({ id: "real-1", event_type: "partnership_llm_call", cost_usd: 0.09, created_at: new Date().toISOString(), context: { partnershipId: "prospect-1" } });
    await releasePartnershipBudgetReservation(asSupabase(c), reservationId, true);

    expect(c.tables.cost_events!.find((r) => r.context?.settledReservationId === reservationId)).toBeUndefined(); // conservative charge reversed
    expect(c.tables.cost_events!.find((r) => r.id === "real-1")).toBeDefined(); // real recorded cost remains, uniquely counted
  });

  it("release WITHOUT a confirmed real cost leaves an already-settled conservative charge in place -- no positive evidence disproving a real charge occurred, so the conservative charge is kept", async () => {
    const c = client();
    const { reservationId } = await reservePartnershipBudget(asSupabase(c), "generation", 0.25, "prospect-1");
    c.tables.partnership_budget_reservations![0]!.created_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await reservePartnershipBudget(asSupabase(c), "generation", 0.01, "prospect-2");
    expect(c.tables.cost_events!.find((r) => r.context?.settledReservationId === reservationId)).toBeDefined();

    // The original request finishes having recorded NOTHING (total failure
    // -- e.g. every reviewer call also failed) and calls release with the
    // default (false).
    await releasePartnershipBudgetReservation(asSupabase(c), reservationId);

    expect(c.tables.cost_events!.find((r) => r.context?.settledReservationId === reservationId)).toBeDefined(); // conservative charge KEPT
  });

  it("release on a reservation that was NEVER settled (the normal fast path) never touches cost_events at all", async () => {
    const c = client();
    const { reservationId } = await reservePartnershipBudget(asSupabase(c), "generation", 0.25, "prospect-1");
    c.tables.cost_events!.push({ id: "real-1", event_type: "partnership_llm_call", cost_usd: 0.09, created_at: new Date().toISOString() });
    await releasePartnershipBudgetReservation(asSupabase(c), reservationId, true);
    // Still exactly the one real row -- release() had nothing to reverse.
    expect(c.tables.cost_events).toHaveLength(1);
  });

  it("CONCURRENCY: a second reservation attempt correctly accounts for a first reservation's settlement, even when the settlement only just happened", async () => {
    const oldReservation = { id: "old-3", bucket: "generation", amount_usd: 0.25, prospect_id: null, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), released_at: null, settled_as_charge: false };
    // $9.76 real + $0.25 about-to-settle = $10.01, already over the $10.00
    // cap -- a concurrent reserve attempt landing right after settlement
    // must see the now-real charge and correctly deny.
    const c = client({
      cost_events: [{ event_type: "partnership_llm_call", cost_usd: 9.76, created_at: new Date().toISOString() }],
      partnership_budget_reservations: [oldReservation],
    });
    const result = await reservePartnershipBudget(asSupabase(c), "generation", 0.01);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/bucket_budget_reached/);
  });

  it("directly exercises the shared cap as an independent gate: denies a reservation that clears its own bucket cap but would exceed a (deliberately overridden-for-this-test) shared cap", async () => {
    // budgetReservation.ts's own module-level bucket caps ($1 discovery /
    // $2 generation) sum to exactly the default $3 shared cap, so under
    // default config the shared check can never bind more tightly than
    // the two bucket checks combined -- it's a redundant safety net by
    // construction. This test exercises the underlying mechanism
    // (migration 0024's reserve_partnership_budget, modeled 1:1 in the
    // fake) directly with a smaller shared cap than the bucket cap alone
    // would allow, proving the shared check is real and independently
    // enforced, not just theoretically present.
    const c = client({ cost_events: [{ event_type: "partnership_llm_call", cost_usd: 2.9, created_at: new Date().toISOString() }] });
    const { data } = await (c as any).rpc("reserve_partnership_budget", {
      p_amount_usd: 0.05,
      p_bucket: "generation",
      p_prospect_id: null,
      p_bucket_budget_usd: 10, // generously clears the bucket check on its own
      p_total_budget_usd: 2.92, // but the shared cap is nearly already spent
    });
    const row = data[0];
    expect(row.eligible).toBe(false);
    expect(row.reason).toMatch(/shared_budget_reached/);
  });
});
