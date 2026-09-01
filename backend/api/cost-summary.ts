import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";

/**
 * Real spend, not an estimate -- every row here comes from an actual
 * Claude API response's own usage field (see costTracking.ts). Read-only.
 * The point of this endpoint existing before anything (like run-campaign)
 * gets auto-scheduled on a cron: nobody should turn on unattended LLM
 * spending without a real number to look at first.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("cost_events")
      .select("cost_usd, input_tokens, output_tokens, model, created_at");
    if (error) throw error;

    const rows = (data ?? []) as Array<{
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      model: string;
      created_at: string;
    }>;

    const totalCostUsd = rows.reduce((sum, r) => sum + Number(r.cost_usd), 0);
    const totalInputTokens = rows.reduce((sum, r) => sum + r.input_tokens, 0);
    const totalOutputTokens = rows.reduce((sum, r) => sum + r.output_tokens, 0);

    const last24hCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const last24hCostUsd = rows
      .filter((r) => r.created_at >= last24hCutoff)
      .reduce((sum, r) => sum + Number(r.cost_usd), 0);

    res.status(200).json({
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      last24hCostUsd: Number(last24hCostUsd.toFixed(6)),
      totalCalls: rows.length,
      totalInputTokens,
      totalOutputTokens,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
