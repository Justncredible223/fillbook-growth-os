/**
 * The comment the owner posts and pins under each video, pointing viewers to the free sample (the redesign brief's
 * "reason to click": pinned comment with fillbookhq.com/sample, plus the bio link). It is shown on Video Status with a
 * Copy button; posting and pinning stay the owner's manual step, because neither TikTok's nor YouTube's API can pin a
 * comment (and nothing in this system posts to a platform without the owner).
 *
 * Plain text with no markup, because platforms differ on links in comments. Every line says the data is sample data,
 * never says "live" or "real-time" about tracking, promises no result, and gives no trading advice.
 */
export const PINNED_COMMENT_LINK = "fillbookhq.com/sample";

/**
 * One wording for every video. It opens with the link and the invitation, not a disclaimer (a pinned comment is the
 * first thing a viewer reads, and TikTok's bubble preview over the video cuts it off after about 70 characters, so a
 * link at the end would never show in it), then says plainly that this is a sample account rather than a real trader's
 * data, which the caption's own "Demo data" line already backs up.
 */
export const PINNED_COMMENT = `${PINNED_COMMENT_LINK}: open this same screen with the demo data yourself. Sample account, not a real trader's data.`;

/** The comment to pin under a video. Kept as a function of the hook so callers need not change if wordings ever vary again. */
export function buildPinnedComment(_hook: string): string {
  return PINNED_COMMENT;
}
