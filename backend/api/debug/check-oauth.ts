import type { VercelRequest, VercelResponse } from "@vercel/node";
import { constantTimeEquals } from "../../src/lib/requireAppAuth.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

interface CheckResult {
  ok: boolean;
  status?: number;
  error?: string;
}

async function checkRefresh(clientIdEnv: string, clientSecretEnv: string, refreshTokenEnv: string): Promise<CheckResult> {
  const clientId = process.env[clientIdEnv];
  const clientSecret = process.env[clientSecretEnv];
  const refreshToken = process.env[refreshTokenEnv];
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, error: `${clientIdEnv}/${clientSecretEnv}/${refreshTokenEnv} not all set` };
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Strip anything that could echo back a secret-shaped value.
    const safeBody = body.replace(/"(access_token|refresh_token)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"');
    return { ok: false, status: res.status, error: safeBody.slice(0, 500) };
  }
  return { ok: true, status: res.status };
}

/**
 * One-off diagnostic: exercises the exact refresh_token grant the real
 * adapters use, without running any of the rest of the pipeline (no
 * posting, no publishing, no spend) -- only proves the OAuth client/secret
 * and token pairs are internally consistent after the 2026-09-22 client
 * migration. Not wired into any cron; call manually, then delete.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const debugToken = process.env.DEBUG_OAUTH_CHECK_TOKEN;
  if (!debugToken) {
    res.status(500).json({ error: "DEBUG_OAUTH_CHECK_TOKEN is not configured on the server" });
    return;
  }
  if (!req.headers.authorization || !constantTimeEquals(req.headers.authorization, `Bearer ${debugToken}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [google, youtube] = await Promise.all([
    checkRefresh("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"),
    checkRefresh("YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"),
  ]);

  res.status(200).json({ google, youtube });
}
