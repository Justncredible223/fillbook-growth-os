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
 * call this in a finally block, success or failure.
 *
 * [hasConfirmedRealCost] must be true only when the caller positively
 * knows real cost_events rows were recorded for the SAME attempt this
 * reservation covered (e.g. `usages.length` grew during this specific
 * attempt) -- see migration 0025. If this reservation had already expired
 * and been conservatively settled into a charge (the owning request ran
 * long, or is only now reaching its finally after a delay), passing true
 * here reverses that conservative charge since the real recorded cost
 * supersedes it; passing false (the default -- nothing succeeded, or the
 * caller can't positively confirm real cost was recorded) leaves any such
 * settled charge in place, favoring under-spending safety over precision
 * for a call whose true cost is genuinely unknown. Never touches
 * cost_events for a reservation that was NOT settled (the normal,
 * fast-path case) -- release is then a pure no-op besides marking
 * released_at, exactly as before migration 0025.
 *
 * Best-effort: if this write itself fails, migration 0024's expiry window
 * (default 300s) still reclaims -- conservatively, as a real charge, not
 * silently -- the reservation on the next reserve call.
 */
export async function releasePartnershipBudgetReservation(
  client: SupabaseClient,
  reservationId: string | null,
  hasConfirmedRealCost: boolean = false,
): Promise<void> {
  if (!reservationId) return;
  try {
    await client.rpc("release_partnership_budget_reservation", {
      p_reservation_id: reservationId,
      p_confirmed_real_cost_recorded: hasConfirmedRealCost,
    });
  } catch {
    // Deliberately swallowed -- see docstring above.
  }
}
