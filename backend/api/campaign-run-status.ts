import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

/**
 * Polled by the app after POST /api/run-campaign returns a
 * campaignRunRequestId (see that endpoint's own doc comment for why the
 * actual pipeline no longer runs inline). Read-only, cheap, and side-effect
 * free -- safe to poll every couple of seconds.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const id = req.query.id;
  if (typeof id !== "string" || !id) {
    res.status(400).json({ error: "Query param 'id' (campaignRunRequestId) is required" });
    return;
  }

  try {
    const client = getServiceClient();
    const { data, error } = await client
      .from("campaign_run_requests")
      .select("status, campaign_asset_id, final_stage, block_reasons, cost_usd, error")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`load campaign_run_requests failed: ${error.message}`);
    if (!data) {
      res.status(404).json({ error: `No campaign run request with id ${id}` });
      return;
    }

    res.status(200).json({
      status: data.status as "queued" | "running" | "ready" | "failed",
      campaignAssetId: data.campaign_asset_id,
      finalStage: data.final_stage,
      blockReasons: data.block_reasons ?? [],
      costUsd: data.cost_usd,
      error: data.error,
    });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
