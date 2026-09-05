import type { PartnershipProspect } from "./types.js";

/** Default, bounded follow-up sequence -- never more than this many follow-up drafts per prospect, per the mission's explicit "default to no more than two follow-up drafts." */
export const MAX_FOLLOW_UP_DRAFTS = 2;

/** How many days after contact (or the last follow-up) before another follow-up is due. */
export const FOLLOW_UP_INTERVAL_DAYS = 5;

/** True once a prospect has reached a state where follow-ups must stop -- a reply, a decline (do_not_contact), or an owner closure. Never automated past this point. */
export function shouldStopFollowUps(prospect: Pick<PartnershipProspect, "stage">): boolean {
  return prospect.stage === "replied" || prospect.stage === "do_not_contact" || prospect.stage === "closed" || prospect.stage === "archived" || prospect.stage === "pilot" || prospect.stage === "active_partner";
}

/**
 * A follow-up is due only relative to when the prospect was ACTUALLY
 * contacted (or last followed up with), never relative to when a draft
 * was merely generated -- generating a draft doesn't start any clock.
 * `lastFollowUpAt` should be the most recent 'follow_up_sent' interaction's
 * `occurredAt`, if any; otherwise pass `contactedAt`.
 */
export function isFollowUpDue(
  prospect: Pick<PartnershipProspect, "stage" | "contactedAt" | "followUpCount">,
  lastFollowUpAt: string | null,
  now: Date,
): boolean {
  if (shouldStopFollowUps(prospect)) return false;
  if (prospect.stage !== "contacted") return false;
  if (prospect.followUpCount >= MAX_FOLLOW_UP_DRAFTS) return false;
  const since = lastFollowUpAt ?? prospect.contactedAt;
  if (!since) return false;
  const dueAt = new Date(since).getTime() + FOLLOW_UP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() >= dueAt;
}
