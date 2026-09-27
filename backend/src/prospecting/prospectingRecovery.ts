import type { SupabaseClient } from "@supabase/supabase-js";
import { assessReplyVisibility, type ReplyVisibility } from "../posting/postingPlan.js";
import { RECOVERY_DAILY_REPLY_CAP, RECOVERY_MAX_POST_AGE_MS } from "./prospectingPacing.js";

/**
 * Recovery mode (owner request 2026-09-26). X started hiding @FillbookHQ's replies on 2026-09-24 (1-4 views against a
 * normal of 7-23). While that lasts, cold replies are almost worthless and more of them, especially ones naming the
 * product, can keep the flag on. So recovery mode switches itself on whenever the reply-visibility check reads
 * "dropped" and off when reply views recover -- nobody has to remember to undo it.
 *
 * While active: at most RECOVERY_DAILY_REPLY_CAP cold replies a day, only on posts under 4 hours old, and reply
 * drafts never name Fillbook (enforced in draftProspectingCandidateReply). Inbound replies are unaffected.
 */
export interface RecoveryState {
  active: boolean;
  dailyCap: number | null;
  maxPostAgeHours: number | null;
  visibility: ReplyVisibility | null;
}

export const RECOVERY_OFF: RecoveryState = { active: false, dailyCap: null, maxPostAgeHours: null, visibility: null };

export function recoveryFromVisibility(visibility: ReplyVisibility): RecoveryState {
  if (visibility.status !== "dropped") return { ...RECOVERY_OFF, visibility };
  return { active: true, dailyCap: RECOVERY_DAILY_REPLY_CAP, maxPostAgeHours: RECOVERY_MAX_POST_AGE_MS / 3600000, visibility };
}

/** Reads the account's own recent replies (x_own_posts, synced 3x a day) and decides. Any read error means "off". */
export async function loadRecoveryState(client: SupabaseClient, now: Date = new Date()): Promise<RecoveryState> {
  let data: unknown[] | null;
  try {
    const result = await client
      .from("x_own_posts")
      .select("created_at, impressions")
      .eq("kind", "reply")
      .gte("created_at", new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString());
    if (result.error) return RECOVERY_OFF;
    data = result.data;
  } catch {
    return RECOVERY_OFF;
  }
  const replies = ((data ?? []) as Array<{ created_at: string; impressions: number | null }>).map((r) => ({ createdAt: new Date(r.created_at), impressions: r.impressions }));
  return recoveryFromVisibility(assessReplyVisibility(replies, now));
}

/** The note added to a reply draft's prompt while recovery mode is on. */
export const RECOVERY_DRAFT_NOTE = `RECOVERY MODE IS ON: X is currently limiting this account's replies. For this reply, do NOT name or hint at
Fillbook at all -- no product, no "we built", no "we track". Set showcase to "none". Just be genuinely useful and specific
to their post; that is what rebuilds the account's standing.`;

/** True if a draft names Fillbook -- rejected outright while recovery mode is on. */
export function namesFillbook(reply: string): boolean {
  return /\bfillbook/i.test(reply);
}
