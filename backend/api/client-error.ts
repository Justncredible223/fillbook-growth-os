import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";

/**
 * Where the Android app's global uncaught-exception handler (see
 * CrashReporter.kt) reports a crash it already wrote to local disk. This
 * is the 12th and last serverless function Vercel's Hobby plan allows
 * for this project (see the ingest.ts/daily-pipeline.ts comments on the
 * same cap) -- deliberately just a console.error into Vercel's own
 * function logs rather than a new Supabase table + migration, since a
 * crash report doesn't need to be queryable, just visible to whoever
 * checks `vercel logs` after a user reports a problem.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as
      | { message?: string; stackTrace?: string; appVersion?: string; deviceInfo?: string; occurredAt?: string }
      | undefined;

    console.error(
      "[client-crash]",
      JSON.stringify({
        message: body?.message ?? "(no message)",
        appVersion: body?.appVersion ?? "unknown",
        deviceInfo: body?.deviceInfo ?? "unknown",
        occurredAt: body?.occurredAt ?? new Date().toISOString(),
        stackTrace: body?.stackTrace ?? "(no stack trace)",
      }),
    );

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
