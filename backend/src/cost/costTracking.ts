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
