import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Gate for every endpoint the Android app calls. Before this existed, the
 * only thing standing between the public internet and this project's
 * Supabase-backed business data (spend, drafts, approve/reject) was
 * Vercel's deployment-protection-bypass header -- a single static value
 * that has to be embedded in the client to let the app through at all,
 * which means it was never actually a secret. This checks a second,
 * separate token (APP_API_TOKEN) that the app now asks its user to enter
 * once and stores encrypted on-device, instead of shipping baked into
 * the APK. Returns true and lets the caller continue if the request is
 * authorized; writes a 401 and returns false otherwise.
 */
export function requireAppAuth(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.APP_API_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "APP_API_TOKEN is not configured on the server" });
    return false;
  }

  const header = req.headers.authorization;
  if (header !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }

  return true;
}
