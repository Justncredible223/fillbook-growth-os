import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_RETENTION_DAYS } from "./videoRenderEligibility.js";
import { markVideoStorageReservationDeleted } from "./videoStorageReservation.js";

const STORAGE_BUCKET = "rendered-videos";

interface VideoRenderRow {
  id: string;
  storage_path: string | null;
  thumbnail_path: string | null;
  status: "queued" | "rendering" | "ready" | "failed" | "canceled";
}

/**
 * Deletes Storage objects for ready/failed renders older than
 * VIDEO_RETENTION_DAYS, following the exact pruneOldCostEvents idiom
 * (costTracking.ts) -- stateless, re-evaluated fresh every run, never
 * throws uncaught (runStep wraps it). Critically: a video_renders row and
 * its storage_reservations row are only ever deleted/marked-deleted AFTER
 * the Storage delete call itself confirms success -- see the
 * implementation plan's "Storage safeguards" section. A failed Storage
 * delete leaves both untouched so committed usage is never
 * under-counted, and the next day's run retries it.
 */
export async function pruneOldVideoRenders(client: SupabaseClient, now: Date = new Date()): Promise<string> {
  const cutoff = new Date(now.getTime() - VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: candidatesError } = await client
    .from("video_renders")
    .select("id, storage_path, thumbnail_path, status")
    .in("status", ["ready", "failed"])
    .lt("updated_at", cutoff);
  if (candidatesError) throw new Error(`pruneOldVideoRenders failed to load candidates: ${candidatesError.message}`);
  const rows = (candidates ?? []) as VideoRenderRow[];
  if (rows.length === 0) return `0 renders older than ${VIDEO_RETENTION_DAYS}d`;

  let deleted = 0;
  let skippedNoPath = 0;
  let failedDeletes = 0;

  for (const row of rows) {
    const pathsToDelete = [row.storage_path, row.thumbnail_path].filter((p): p is string => p !== null);
    if (pathsToDelete.length === 0) {
      // A 'failed' render that never produced an object -- nothing to
      // delete in Storage, but the row itself and any reservation are
      // still cleaned up (a failed render still holds a reservation from
      // the pre-upload reserve call if it got that far, or none at all).
      const { error: deleteRowError } = await client.from("video_renders").delete().eq("id", row.id);
      if (deleteRowError) throw new Error(`pruneOldVideoRenders failed to delete video_renders row ${row.id}: ${deleteRowError.message}`);
      skippedNoPath++;
      continue;
    }

    const { error: storageError } = await client.storage.from(STORAGE_BUCKET).remove(pathsToDelete);
    if (storageError) {
      // Storage delete failed -- leave the row and its reservation
      // exactly as-is (still 'committed'), retry on the next run.
      failedDeletes++;
      continue;
    }

    const { data: reservation } = await client
      .from("video_storage_reservations")
      .select("id")
      .eq("video_render_id", row.id)
      .eq("status", "committed")
      .maybeSingle();
    if (reservation) {
      await markVideoStorageReservationDeleted(client, (reservation as { id: string }).id);
    }

    const { error: deleteRowError } = await client.from("video_renders").delete().eq("id", row.id);
    if (deleteRowError) throw new Error(`pruneOldVideoRenders failed to delete video_renders row ${row.id}: ${deleteRowError.message}`);
    deleted++;
  }

  return `${deleted} deleted, ${skippedNoPath} deleted with no storage object, ${failedDeletes} storage deletes failed (retrying next run)`;
}
