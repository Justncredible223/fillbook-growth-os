import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage";
import { getServiceClient } from "../src/lib/supabaseClient";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository";

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
