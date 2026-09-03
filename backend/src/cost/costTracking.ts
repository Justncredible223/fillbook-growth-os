import type { SupabaseClient } from "@supabase/supabase-js";
import type { LlmUsage } from "../content/llmClient.js";

/**
 * USD per million tokens, Anthropic's standard (non-batch) API pricing as
 * of this writing. Re-verify against platform.claude.com/settings/billing
 * or Anthropic's pricing page before trusting this for anything beyond a
 * rough running total -- pricing changes over time and this file won't
 * update itself.
 */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-5-20250929": { input: 3, output: 15 },
};
const DEFAULT_PRICING = { input: 3, output: 15 };

export function estimateCostUsd(usage: LlmUsage): number {
  const pricing = PRICING_PER_MILLION_TOKENS[usage.model] ?? DEFAULT_PRICING;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Persists one real LLM call's cost. Never blocks or fails the caller's
 * actual work if this write fails -- cost visibility matters, but it
 * should never be the reason a real review agent call gets lost.
 */
export async function recordCostEvent(
  client: SupabaseClient,
  usage: LlmUsage,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    await client.from("cost_events").insert({
      event_type: "llm_call",
      provider: "anthropic",
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cost_usd: estimateCostUsd(usage),
      context,
    });
  } catch {
    // Deliberately swallowed -- see docstring above.
  }
}

/** X's general read rate ($0.005/read) -- NOT the cheaper $0.001 Owned Reads tier, since a search result isn't the authenticated user's own resource. See docs/PROGRESS_LEDGER.md Phase 4. */
export const X_SEARCH_COST_PER_READ_USD = 0.005;

/**
 * Persists one X search API call's cost -- resultsReturned reads billed at
 * the general (non-Owned-Reads) rate. Same silent-failure contract as
 * recordCostEvent above: cost visibility must never block the actual
 * search/ingestion work.
 */
export async function recordXSearchCostEvent(
  client: SupabaseClient,
  resultsReturned: number,
  context: Record<string, unknown> = {},
): Promise<number> {
  const costUsd = resultsReturned * X_SEARCH_COST_PER_READ_USD;
  try {
    await client.from("cost_events").insert({
      event_type: "x_search_read",
      provider: "x",
      model: "search/recent",
      input_tokens: 0,
      output_tokens: resultsReturned,
      cost_usd: costUsd,
      context,
    });
  } catch {
    // Deliberately swallowed -- see recordCostEvent's docstring above.
  }
  return costUsd;
}

/** Real recorded X-search spend for the given month (created_at-based, not run_date -- x_search_read events have no separate "run date" concept), for Prospecting's budget gate. */
export async function getProspectingMonthSpendUsd(client: SupabaseClient, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const { data, error } = await client
    .from("cost_events")
    .select("cost_usd")
    .eq("event_type", "x_search_read")
    .gte("created_at", monthStart)
    .lt("created_at", nextMonthStart);
  if (error) throw new Error(`getProspectingMonthSpendUsd failed: ${error.message}`);
  return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}
