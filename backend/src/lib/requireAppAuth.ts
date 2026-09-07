import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

/**
 * Gate for every endpoint the Android app calls. Before this existed, the
 * only thing standing between the public internet and this project's
 * Supabase-backed business data (spend, drafts, approve/reject) was
 * Vercel's deployment-protection-bypass header -- a single static value
 * that has to be embedded in the client to let the app through at all,
 * which means it was never actually a secret. This checks a second,
 * separate token (APP_API_TOKEN): a fixed value injected into the Android
 * build at compile time (see android/app/build.gradle.kts's secretValue()
 * and AppConfig.kt), never typed or stored by the owner at runtime -- there
 * is no "enter it once" flow in this app.
 *
 * APP_API_TOKEN_PREVIOUS (optional) exists purely to make token rotation
 * safe: during a rotation, the server is redeployed with the NEW value in
 * APP_API_TOKEN and the OUTGOING value in APP_API_TOKEN_PREVIOUS, so
 * whichever APK build the owner's device is still running (old or new
 * token) keeps working until the new APK is confirmed installed, at which
 * point APP_API_TOKEN_PREVIOUS is removed in a follow-up deploy. Only
 * APP_API_TOKEN is required -- APP_API_TOKEN_PREVIOUS being unset is a
 * normal, non-error "not currently mid-rotation" state, not a
 * misconfiguration.
 *
 * Returns true and lets the caller continue if the request's bearer token
 * matches either currently-accepted value; writes a 401 and returns false
 * otherwise, or a 500 if the server itself isn't configured at all.
 */
export function requireAppAuth(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.APP_API_TOKEN;
  if (!expected) {
    res.status(500).json({ error: "APP_API_TOKEN is not configured on the server" });
    return false;
  }

  const header = req.headers.authorization;
  if (!header) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return false;
  }

  // Both comparisons always run, never short-circuited on the first match --
  // same rationale as constantTimeEquals itself, extended from "matches THE
  // one accepted value" to "matches ANY of the presently-accepted values"
  // so a rotation in progress can't be distinguished via response timing.
  const previous = process.env.APP_API_TOKEN_PREVIOUS;
  const matchesCurrent = constantTimeEquals(header, `Bearer ${expected}`);
  const matchesPrevious = previous ? constantTimeEquals(header, `Bearer ${previous}`) : false;

  if (!matchesCurrent && !matchesPrevious) {
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
