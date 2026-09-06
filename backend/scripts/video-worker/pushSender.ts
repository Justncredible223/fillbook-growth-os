import { readFileSync } from "node:fs";
import { cert, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

/**
 * Thin wrapper around the Firebase Admin SDK, kept separate from
 * renderWorker.ts's polling loop so the loop's retry/lease logic stays
 * fully unit-testable against a fake (never a real FCM call in tests).
 * See docs (implementation plan, "Notification reliability") for why
 * `messaging/registration-token-not-registered` is the one error that
 * gets special (permanent, no-retry) handling.
 */
export interface PushSendResult {
  ok: boolean;
  isRevokedToken: boolean;
  error?: string;
}

let app: App | null = null;

function getApp(): App {
  if (app) return app;
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH;
  if (!credentialPath) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON_PATH is not set -- required to send FCM pushes.");
  }
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf-8"));
  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

const REVOKED_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

export interface RenderNotificationPayload {
  videoRenderId: string;
  kind: "ready" | "failed";
  campaignTitle: string;
  error?: string | null;
}

/** Sends one data+notification push for a render outcome, deep-linkable by the Android app via the `videoRenderId` data field into its Video Status screen. */
export async function sendRenderNotification(fcmToken: string, payload: RenderNotificationPayload): Promise<PushSendResult> {
  const title = payload.kind === "ready" ? "Video ready" : "Video render failed";
  const body =
    payload.kind === "ready"
      ? `"${payload.campaignTitle}" finished rendering -- tap to download or share.`
      : `"${payload.campaignTitle}" failed to render${payload.error ? `: ${payload.error}` : "."}`;
  try {
    await getMessaging(getApp()).send({
      token: fcmToken,
      notification: { title, body },
      data: { videoRenderId: payload.videoRenderId, kind: payload.kind },
    });
    return { ok: true, isRevokedToken: false };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    const isRevokedToken = REVOKED_TOKEN_ERROR_CODES.has(code);
    return { ok: false, isRevokedToken, error: (err as Error).message ?? String(err) };
  }
}
