import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Independent monthly budget line, same reasoning as
 * X_FEED_POST_MONTHLY_BUDGET_USD (dailyXFeedPost.ts): a separate feature's
 * spend must never compete with or be silently starved by auto-draft's,
 * prospecting's, or x-feed-post's own budgets.
 *
 * $3.00 default explicitly approved by the owner (2026-09-05) -- covers
 * ~35 full-quality drafts/month (1 draft + all 9 reviewers, no cut
 * corners) against a realistic first-phase volume of a handful of real
 * prospects. Overridable via PARTNERSHIP_MONTHLY_BUDGET_USD without a
 * code change if the owner wants a different number later.
 */
export const PARTNERSHIP_MONTHLY_BUDGET_USD = Number(process.env.PARTNERSHIP_MONTHLY_BUDGET_USD) || 3.0;

export interface EligibilityCheckResult {
  eligible: boolean;
  reason?: string;
}

export function evaluatePartnershipBudget(monthSpendUsd: number, budgetUsd: number = PARTNERSHIP_MONTHLY_BUDGET_USD): EligibilityCheckResult {
  if (budgetUsd <= 0) {
    return { eligible: false, reason: "partnership_budget_disabled (PARTNERSHIP_MONTHLY_BUDGET_USD explicitly set to 0)" };
  }
  if (monthSpendUsd >= budgetUsd) {
    return { eligible: false, reason: `monthly_budget_reached ($${monthSpendUsd.toFixed(4)} spent, cap is $${budgetUsd.toFixed(2)})` };
  }
  return { eligible: true };
}

/**
 * Real recorded spend this calendar month across BOTH of Partnerships'
 * own cost sources -- pitch-generation LLM calls ("partnership_llm_call")
 * and discovery's X search reads ("partnership_x_search_read", see
 * costTracking.ts's recordPartnershipXSearchCostEvent) -- summed under
 * ONE gate, per the mission's Phase 7 requirement that discovery and
 * generation share a single budget rather than each getting its own.
 * Fully independent of every other feature's budget line (Prospecting's
 * own X-search spend is tracked under the separate "x_search_read" type).
 */
export async function getPartnershipMonthSpendUsd(client: SupabaseClient, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const { data, error } = await client
    .from("cost_events")
    .select("cost_usd")
    .in("event_type", ["partnership_llm_call", "partnership_x_search_read"])
    .gte("created_at", monthStart)
    .lt("created_at", nextMonthStart);
  if (error) throw new Error(`getPartnershipMonthSpendUsd failed: ${error.message}`);
  return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}
