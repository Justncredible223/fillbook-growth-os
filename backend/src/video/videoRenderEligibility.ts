/**
 * Every threshold here is a real, documented policy decision, not a
 * placeholder -- see the phone-only video render pipeline implementation
 * plan for the reasoning behind each number, and docs/VIDEO_FACTORY.md
 * for the render pipeline these gate.
 */

/**
 * Hard monthly ceiling on how many renders can be QUEUED, independent of
 * and unrelated to any LLM/Anthropic budget -- rendering itself calls no
 * LLM at all (only the earlier, separate script-generation step does,
 * already covered by MONTHLY_AUTO_DRAFT_BUDGET_USD). Sized generously
 * above realistic usage (5 gap-days/week * ~4.3 weeks ~= 22/month) while
 * still bounding worst-case Storage/bandwidth impact from a burst of
 * approvals. Enforced inside enqueue_video_render's own transaction
 * (migration 0027), not in application code, so it can never be
 * bypassed by a caller that forgets to check it.
 */
export const MAX_VIDEO_RENDERS_PER_MONTH = 30;

/**
 * Hard total-bytes ceiling on committed video Storage usage -- half of
 * Supabase Free tier's 1GB Storage allowance, leaving real headroom for
 * the rest of the project (which shares the same overall Free-tier
 * budget) and for a temporary backlog if a retention run is ever missed.
 * Enforced by reserve_video_storage_bytes (migration 0027) against
 * committed + still-open reservations only -- never a mere reservation
 * counted as permanent usage. See videoStorageReservation.ts for the
 * TypeScript wrapper around that RPC.
 */
export const MAX_VIDEO_STORAGE_BYTES = 500 * 1024 * 1024;

/** How long a video render stays in Storage before the daily retention sweep deletes it. */
export const VIDEO_RETENTION_DAYS = 7;

export interface EligibilityCheckResult {
  eligible: boolean;
  reason?: string;
}

/** Pure helper mirroring the same monthly-cap math enqueue_video_render's SQL performs, exposed for direct unit testing without a live database. */
export function evaluateVideoRenderMonthlyCap(rendersThisMonth: number, cap: number = MAX_VIDEO_RENDERS_PER_MONTH): EligibilityCheckResult {
  if (rendersThisMonth >= cap) {
    return { eligible: false, reason: `monthly_render_cap_reached (${rendersThisMonth} renders this month, cap is ${cap})` };
  }
  return { eligible: true };
}

/** Pure helper mirroring reserve_video_storage_bytes's cap math, exposed for direct unit testing without a live database. */
export function evaluateVideoStorageCap(
  committedBytes: number,
  reservedBytes: number,
  requestedBytes: number,
  cap: number = MAX_VIDEO_STORAGE_BYTES,
): EligibilityCheckResult {
  if (committedBytes + reservedBytes + requestedBytes > cap) {
    return {
      eligible: false,
      reason: `storage_cap_reached (committed ${committedBytes} + reserved ${reservedBytes} + requested ${requestedBytes} exceeds cap ${cap})`,
    };
  }
  return { eligible: true };
}
