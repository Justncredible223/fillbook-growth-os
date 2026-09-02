import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `integration_health` (migration 0001) existed in the schema from the
 * very first migration but was never read or written anywhere -- a real,
 * confirmed dead table. Using it here rather than adding a parallel one.
 * Every sync attempt records itself here BEFORE the actual work runs, so
 * a crash mid-sync still leaves `last_attempted_at` current -- an
 * inbound queue that looks merely quiet is indistinguishable from one
 * that's silently broken unless the attempt itself is the thing
 * recorded, not just successful outcomes.
 */
export async function recordSyncAttempt(client: SupabaseClient, platform: string): Promise<void> {
  const { error } = await client.from("integration_health").upsert(
    { platform, last_attempted_at: new Date().toISOString() },
    { onConflict: "platform" },
  );
  if (error) throw new Error(`recordSyncAttempt failed: ${error.message}`);
}

export async function recordSyncSuccess(client: SupabaseClient, platform: string, notes: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client.from("integration_health").upsert(
    { platform, status: "healthy", last_checked_at: now, last_success_at: now, last_error: null, notes },
    { onConflict: "platform" },
  );
  if (error) throw new Error(`recordSyncSuccess failed: ${error.message}`);
}

export async function recordSyncFailure(client: SupabaseClient, platform: string, errorMessage: string): Promise<void> {
  const { error } = await client.from("integration_health").upsert(
    { platform, status: "down", last_checked_at: new Date().toISOString(), last_error: errorMessage },
    { onConflict: "platform" },
  );
  if (error) throw new Error(`recordSyncFailure failed: ${error.message}`);
}
