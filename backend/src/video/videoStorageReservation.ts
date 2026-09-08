import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_VIDEO_STORAGE_BYTES } from "./videoRenderEligibility.js";

export interface VideoStorageReservation {
  reservationId: string | null;
  eligible: boolean;
  reason?: string;
}

/**
 * Atomically reserves `bytes` -- BEFORE any upload starts, never after --
 * against committed usage + still-open reservations only (see migration
 * 0027's reserve_video_storage_bytes, locked via pg_advisory_xact_lock,
 * same idiom as Partnerships' reserve_partnership_budget). A mere
 * reservation is never counted as permanent usage; only
 * commitVideoStorageReservation makes it so, and only after a real
 * upload succeeds.
 *
 * As a side effect, this call also self-heals any reservation whose
 * lease expired without ever being committed (a crashed worker) --
 * see migration 0027's doc comment for why this makes "reconcile on the
 * next worker run" true without a separate cleanup job.
 *
 * Callers MUST call commitVideoStorageReservation on upload success, or
 * releaseVideoStorageReservation in a finally block on any failure --
 * see each call site.
 */
export async function reserveVideoStorageBytes(
  client: SupabaseClient,
  videoRenderId: string,
  bytes: number,
  cap: number = MAX_VIDEO_STORAGE_BYTES,
): Promise<VideoStorageReservation> {
  const { data, error } = await client.rpc("reserve_video_storage_bytes", {
    p_video_render_id: videoRenderId,
    p_bytes: bytes,
    p_cap: cap,
  });
  if (error) throw new Error(`reserveVideoStorageBytes failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { reservation_id: string | null; eligible: boolean; reason: string | null } | undefined;
  if (!row) throw new Error("reserveVideoStorageBytes: reserve_video_storage_bytes returned no row");
  return { reservationId: row.reservation_id, eligible: row.eligible, reason: row.reason ?? undefined };
}

/** Called only after the Storage upload itself has confirmedly succeeded -- only now does this reservation become real, permanent usage. */
export async function commitVideoStorageReservation(client: SupabaseClient, reservationId: string): Promise<void> {
  const { error } = await client.rpc("commit_video_storage_reservation", { p_reservation_id: reservationId });
  if (error) throw new Error(`commitVideoStorageReservation failed: ${error.message}`);
}

/**
 * Called from a finally-style block whenever the process is still alive
 * after a failed render/upload. If the worker dies outright instead (no
 * finally ever runs), the reservation's own lease expiry -- reconciled as
 * a side effect of the next reserveVideoStorageBytes call -- covers it;
 * this function is the fast path, not the only path.
 */
export async function releaseVideoStorageReservation(client: SupabaseClient, reservationId: string | null): Promise<void> {
  if (!reservationId) return;
  const { error } = await client.rpc("release_video_storage_reservation", { p_reservation_id: reservationId });
  if (error) throw new Error(`releaseVideoStorageReservation failed: ${error.message}`);
}

/** Called by pruneOldVideoRenders ONLY after the Storage delete call itself has confirmedly succeeded -- never before. */
export async function markVideoStorageReservationDeleted(client: SupabaseClient, reservationId: string): Promise<void> {
  const { error } = await client.rpc("mark_video_storage_reservation_deleted", { p_reservation_id: reservationId });
  if (error) throw new Error(`markVideoStorageReservationDeleted failed: ${error.message}`);
}
