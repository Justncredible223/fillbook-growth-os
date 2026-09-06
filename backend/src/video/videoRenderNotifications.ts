import type { SupabaseClient } from "@supabase/supabase-js";

export type VideoRenderNotificationKind = "ready" | "failed";

export interface VideoRenderNotificationRow {
  id: string;
  videoRenderId: string;
  deviceTokenId: string;
  kind: VideoRenderNotificationKind;
  status: "pending" | "sending" | "sent" | "failed_permanent";
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
}

interface NotificationRow {
  id: string;
  video_render_id: string;
  device_token_id: string;
  kind: VideoRenderNotificationKind;
  status: VideoRenderNotificationRow["status"];
  attempts: number;
  max_attempts: number;
  lease_owner: string | null;
}

function fromRow(row: NotificationRow): VideoRenderNotificationRow {
  return {
    id: row.id,
    videoRenderId: row.video_render_id,
    deviceTokenId: row.device_token_id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    leaseOwner: row.lease_owner,
  };
}

/**
 * Inserts exactly one notification obligation the moment (and only the
 * moment) a video_renders row reaches a terminal state -- decoupled from
 * whether any send ever succeeds. The unique index on
 * (video_render_id, device_token_id, kind) makes a second call for the
 * same outcome a no-op conflict, never a duplicate row -- this function
 * relies on that constraint rather than re-checking existence itself, so
 * it's safe to call more than once for the same outcome.
 */
export async function queueVideoRenderNotification(
  client: SupabaseClient,
  videoRenderId: string,
  deviceTokenId: string,
  kind: VideoRenderNotificationKind,
): Promise<void> {
  const { error } = await client
    .from("video_render_notifications")
    .upsert(
      { video_render_id: videoRenderId, device_token_id: deviceTokenId, kind },
      { onConflict: "video_render_id,device_token_id,kind", ignoreDuplicates: true },
    );
  if (error) throw new Error(`queueVideoRenderNotification failed: ${error.message}`);
}

/**
 * Atomically claims at most one sendable notification (a fresh `pending`
 * row whose retry time has arrived, or a `sending` row whose lease
 * expired -- a crashed sender) via migration 0027's
 * claim_video_render_notification (FOR UPDATE SKIP LOCKED under the
 * hood), so two concurrent notifier loops can never claim and send the
 * same row. Returns null when there's nothing to send right now.
 */
export async function claimVideoRenderNotification(
  client: SupabaseClient,
  leaseOwner: string,
  leaseSeconds = 60,
): Promise<VideoRenderNotificationRow | null> {
  const { data, error } = await client.rpc("claim_video_render_notification", {
    p_lease_owner: leaseOwner,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claimVideoRenderNotification failed: ${error.message}`);
  const rows = data as NotificationRow[] | null;
  if (!rows || rows.length === 0) return null;
  return fromRow(rows[0]!);
}

/** Once a row is `sent`, nothing ever touches it again -- the claim function's own WHERE clause makes a `sent` row structurally unreachable by any future claim, so this is the only write that ever needs to happen on success. */
export async function markVideoRenderNotificationSent(client: SupabaseClient, notificationId: string): Promise<void> {
  const { error } = await client
    .from("video_render_notifications")
    .update({ status: "sent", sent_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null })
    .eq("id", notificationId)
    .eq("status", "sending");
  if (error) throw new Error(`markVideoRenderNotificationSent failed: ${error.message}`);
}

const BASE_DELAY_MS = 30_000; // 30s
const MAX_DELAY_MS = 60 * 60_000; // 1h cap

/** Same shape as jobs/backoff.ts's decideRetry -- pure, no I/O, fully unit-testable -- but with its own, longer cap appropriate for a best-effort push notification rather than a paid job attempt. */
export function decideNotificationRetry(attemptsAfterThisFailure: number, maxAttempts: number, now: Date = new Date()): { permanent: boolean; nextAttemptAt: Date } {
  if (attemptsAfterThisFailure >= maxAttempts) {
    return { permanent: true, nextAttemptAt: now };
  }
  const delay = Math.min(BASE_DELAY_MS * 2 ** (attemptsAfterThisFailure - 1), MAX_DELAY_MS);
  return { permanent: false, nextAttemptAt: new Date(now.getTime() + delay) };
}

/**
 * Records a failed send attempt. `isRevokedToken` must be true only for
 * FCM's own token-invalid error (`messaging/registration-token-not-registered`
 * / UNREGISTERED / NOT_FOUND) -- that path also marks the device token
 * itself revoked and never retries against a token already known dead,
 * regardless of remaining attempts.
 */
export async function recordVideoRenderNotificationFailure(
  client: SupabaseClient,
  notification: VideoRenderNotificationRow,
  errorMessage: string,
  isRevokedToken: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (isRevokedToken) {
    await client.from("device_push_tokens").update({ revoked_at: now.toISOString() }).eq("id", notification.deviceTokenId);
    const { error } = await client
      .from("video_render_notifications")
      .update({ status: "failed_permanent", attempts: notification.attempts + 1, last_error: errorMessage, lease_owner: null, lease_expires_at: null })
      .eq("id", notification.id)
      .eq("status", "sending");
    if (error) throw new Error(`recordVideoRenderNotificationFailure failed: ${error.message}`);
    return;
  }

  const attempts = notification.attempts + 1;
  const decision = decideNotificationRetry(attempts, notification.maxAttempts, now);
  const { error } = await client
    .from("video_render_notifications")
    .update({
      status: decision.permanent ? "failed_permanent" : "pending",
      attempts,
      last_error: errorMessage,
      next_attempt_at: decision.nextAttemptAt.toISOString(),
      lease_owner: null,
      lease_expires_at: null,
    })
    .eq("id", notification.id)
    .eq("status", "sending");
  if (error) throw new Error(`recordVideoRenderNotificationFailure failed: ${error.message}`);
}
