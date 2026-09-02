import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const repo = new SupabaseOpportunityRepository(getServiceClient());
    const opportunities = await repo.listOpen();
    res.status(200).json({ opportunities });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
