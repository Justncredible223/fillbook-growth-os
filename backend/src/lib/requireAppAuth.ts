import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

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
  if (!header || !constantTimeEquals(header, `Bearer ${expected}`)) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }

  return true;
}

/**
 * Plain `!==` leaks how many leading characters matched via response
 * timing (V8 short-circuits on the first differing byte) -- low real-world
 * risk over the internet given network jitter, but a free, correct fix
 * for a single-owner app's one credential check. `timingSafeEqual`
 * requires equal-length buffers, so a length mismatch is checked first
 * (that comparison is already safe -- length alone reveals far less than
 * a full prefix match would).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
