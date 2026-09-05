import type { SupabaseClient } from "@supabase/supabase-js";
import { PARTNERSHIP_MONTHLY_BUDGET_USD, PARTNERSHIP_DISCOVERY_BUDGET_USD, PARTNERSHIP_GENERATION_BUDGET_USD } from "./budget.js";

export type PartnershipBudgetBucket = "discovery" | "generation";

export interface PartnershipReservation {
  reservationId: string | null;
  eligible: boolean;
  reason?: string;
}

const BUCKET_CAP: Record<PartnershipBudgetBucket, number> = {
  discovery: PARTNERSHIP_DISCOVERY_BUDGET_USD,
  generation: PARTNERSHIP_GENERATION_BUDGET_USD,
};

/**
 * Atomically reserves `amountUsd` -- a conservative CEILING for the paid
 * work about to be dispatched, never the eventual real cost, which isn't
 * known until a response returns -- against BOTH Partnerships' bucket
 * sub-cap and its shared monthly cap in one serialized check (see migration
 * 0024's reserve_partnership_budget, locked via pg_advisory_xact_lock).
 *
 * This is what closes the cross-prospect/cross-request budget race the
 * per-prospect generation_claimed_at mutex (0023) never covered: two
 * concurrent callers -- different prospects, or discovery running
 * alongside generation -- now serialize through this one check instead of
 * each independently reading a stale month-spend total.
 *
 * Callers MUST release the returned reservationId (see
 * releasePartnershipBudgetReservation) in a finally block once the real
 * cost is recorded or the attempt fails -- see each call site.
 */
export async function reservePartnershipBudget(
  client: SupabaseClient,
  bucket: PartnershipBudgetBucket,
  amountUsd: number,
  prospectId: string | null = null,
): Promise<PartnershipReservation> {
  const { data, error } = await client.rpc("reserve_partnership_budget", {
    p_amount_usd: amountUsd,
    p_bucket: bucket,
    p_prospect_id: prospectId,
    p_bucket_budget_usd: BUCKET_CAP[bucket],
    p_total_budget_usd: PARTNERSHIP_MONTHLY_BUDGET_USD,
  });
  if (error) throw new Error(`reservePartnershipBudget failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { reservation_id: string | null; eligible: boolean; reason: string | null } | undefined;
  if (!row) throw new Error("reservePartnershipBudget: reserve_partnership_budget returned no row");
  return { reservationId: row.reservation_id, eligible: row.eligible, reason: row.reason ?? undefined };
}

/**
 * Releases a reservation so it stops counting toward either cap. Always
 * call this in a finally block, success or failure -- it never touches
 * cost_events (the real cost, recorded separately, is the only permanent
 * record), so releasing never double-counts or under-counts real spend.
 * Best-effort: if this write itself fails, migration 0024's expiry window
 * (default 300s) reclaims the reservation automatically rather than
 * leaving it stuck forever.
 */
export async function releasePartnershipBudgetReservation(client: SupabaseClient, reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  try {
    await client.rpc("release_partnership_budget_reservation", { p_reservation_id: reservationId });
  } catch {
    // Deliberately swallowed -- see docstring above.
  }
}
