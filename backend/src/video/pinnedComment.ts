import { createHash } from "node:crypto";

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

const TEMPLATES: readonly string[] = [
  `Want to see this screen on your own trades? Open the free sample: ${PINNED_COMMENT_LINK} (sample data, not real results)`,
  `Everything in this video is sample data. See the same Fillbook screen yourself: ${PINNED_COMMENT_LINK}`,
  `This is a demo account. Open the Fillbook sample and look around: ${PINNED_COMMENT_LINK}`,
  `Curious what your own journal would show? Try the free sample: ${PINNED_COMMENT_LINK} (demo data)`,
];

/** One of a few wordings, chosen from the video's hook so a video always gets the same one and neighbouring videos differ. */
export function buildPinnedComment(hook: string): string {
  const n = createHash("sha256").update(hook).digest().readUInt32BE(0);
  return TEMPLATES[n % TEMPLATES.length]!;
}

export const PINNED_COMMENT_TEMPLATES = TEMPLATES;
