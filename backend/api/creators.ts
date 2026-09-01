import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseCreatorRepository } from "../src/creators/supabaseCreatorRepository.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const repo = new SupabaseCreatorRepository(getServiceClient());
    const creators = await repo.listAll();
    res.status(200).json({ creators });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
