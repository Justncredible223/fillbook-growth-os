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
 *
 * [eventType] defaults to "llm_call" (every existing caller's exact
 * prior behavior -- auto-draft, prospecting's reply writer, Today's X
 * Post, video scripts). Partnerships passes "partnership_llm_call"
 * explicitly -- confirmed live in production that without this, every
 * partnership pitch-generation call was silently recorded under the
 * generic "llm_call" type, which getPartnershipMonthSpendUsd never
 * queries (it only looks for "partnership_llm_call"), so the $3/month
 * cap was never actually gating LLM generation cost, only the separate
 * X-search-read cost. A single shared event_type here would have the
 * opposite problem -- Partnerships' budget would then also count every
 * OTHER feature's LLM spend against its own $3 cap, and vice versa.
 */
export async function recordCostEvent(
  client: SupabaseClient,
  usage: LlmUsage,
  context: Record<string, unknown> = {},
  eventType: string = "llm_call",
): Promise<void> {
  try {
    await client.from("cost_events").insert({
      event_type: eventType,
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

/**
 * Same $0.005/read rate as recordXSearchCostEvent, but its OWN event_type
 * -- Partnerships discovery must never inflate Prospecting's separate
 * getProspectingMonthSpendUsd budget gate (it sums ALL "x_search_read"
 * rows regardless of caller), and Partnerships' own
 * getPartnershipMonthSpendUsd needs to see this spend alongside its LLM
 * pitch-generation cost to enforce ONE shared $3/month cap across
 * discovery + ranking + drafting, per docs/PARTNERSHIPS_MISSION.md
 * Phase 7 ("account for research/provider costs and model
 * generation/review costs ... together").
 */
export async function recordPartnershipXSearchCostEvent(
  client: SupabaseClient,
  resultsReturned: number,
  context: Record<string, unknown> = {},
): Promise<number> {
  const costUsd = resultsReturned * X_SEARCH_COST_PER_READ_USD;
  try {
    await client.from("cost_events").insert({
      event_type: "partnership_x_search_read",
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

/**
 * Reddit's free tier has no documented per-call dollar cost (see
 * docs/REDDIT_INTEGRATION.md), so this records a $0 cost_events row purely
 * for the same per-source/run observability every other adapter gets
 * (System screen counters, /api/health) -- not a budget gate. If Reddit's
 * terms change to a paid tier, this is the one place a real per-read cost
 * would be plugged in, mirroring recordXSearchCostEvent.
 */
export async function recordRedditReadCostEvent(
  client: SupabaseClient,
  resultsReturned: number,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    await client.from("cost_events").insert({
      event_type: "reddit_read",
      provider: "reddit",
      model: "oauth/read",
      input_tokens: 0,
      output_tokens: resultsReturned,
      cost_usd: 0,
      context,
    });
  } catch {
    // Deliberately swallowed -- see recordCostEvent's docstring above.
  }
}

/**
 * Real recorded spend for the given month across BOTH of Prospecting's own
 * cost sources -- its X search reads ("x_search_read") and its reply-writer
 * LLM calls ("prospecting_llm_call", see draftProspectingCandidateReply).
 *
 * Previously this only summed "x_search_read", so the reply-writer's LLM
 * cost was recorded under the generic "llm_call" event_type (shared with
 * auto-draft/inbound/x-feed-post/run-campaign) and never counted against
 * MONTHLY_PROSPECTING_BUDGET_USD at all -- the same bug class Partnerships
 * had (see recordCostEvent's own docstring). Confirmed via
 * cost_events.context->>'endpoint' = 'prospecting-draft': 39 historical rows
 * ($0.3333) were cleanly attributable and reclassified to
 * "prospecting_llm_call"; every other "llm_call" row had its own
 * unambiguous endpoint (run-campaign/x-feed-post/inbound-draft/
 * opportunity-reply-draft) and was left untouched.
 */
export async function getProspectingMonthSpendUsd(client: SupabaseClient, now: Date = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  const { data, error } = await client
    .from("cost_events")
    .select("cost_usd")
    .in("event_type", ["x_search_read", "prospecting_llm_call"])
    .gte("created_at", monthStart)
    .lt("created_at", nextMonthStart);
  if (error) throw new Error(`getProspectingMonthSpendUsd failed: ${error.message}`);
  return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

/** Real recorded spend today (any provider/event_type), created_at-based, UTC calendar day. Distinct from getProspectingMonthSpendUsd (that one is a budget gate scoped to one event_type over a month) -- this is what a "today's spend" display should actually query instead of an unfiltered lifetime sum. */
export async function getTodaySpendUsd(client: SupabaseClient, now: Date = new Date()): Promise<number> {
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { data, error } = await client.from("cost_events").select("cost_usd").gte("created_at", startOfToday);
  if (error) throw new Error(`getTodaySpendUsd failed: ${error.message}`);
  return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

/**
 * cost_events has no retention policy and grows forever -- one row per LLM
 * call and per X search read, indefinitely. Deletes rows older than
 * RETENTION_DAYS so a free-tier (500MB) Supabase project doesn't slowly
 * fill up with cost-ledger history nobody needs after the fact: the real
 * budget gates (getProspectingMonthSpendUsd, autoDraftRunRepository's
 * getMonthSpendUsd) only ever look at the current calendar month, and the
 * "Today's spend" tile only looks at today, so nothing operational reads
 * data this old. Called once/day from daily-pipeline.ts -- deliberately
 * NOT from the 3x/day growth-pulse, since running a delete sweep 3x
 * as often buys nothing.
 */
const RETENTION_DAYS = 180;

export async function pruneOldCostEvents(client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await client.from("cost_events").delete({ count: "exact" }).lt("created_at", cutoff);
  if (error) throw new Error(`pruneOldCostEvents failed: ${error.message}`);
  return `deleted ${count ?? 0} cost_events rows older than ${RETENTION_DAYS}d`;
}
