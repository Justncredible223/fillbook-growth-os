import { buildDestinationUrl } from "../attribution/utmBuilder.js";

export interface PinnedComments {
  tiktok: string;
  youtube: string;
}

/**
 * The comment the owner pins under a posted video, so the click has somewhere to go. Deterministic (no LLM): a fixed
 * line plus the tracked no-signup demo link, one link per platform so the weekly scoreboard can tell them apart. Neither
 * platform lets us post or pin it for the owner (TikTok has no comment API for a creator's own videos; YouTube's API
 * can post a comment but cannot pin one), so the app shows it ready to copy. No earnings claims, no advice.
 */
export function buildPinnedComments(campaignAssetId: string, campaignThesis: string): PinnedComments {
  const line = (platform: string) =>
    `Want to see numbers like these on a dashboard? Try the demo, no signup: ${buildDestinationUrl(campaignAssetId, platform, campaignThesis, "/sample")}`;
  return { tiktok: line("tiktok"), youtube: line("youtube") };
}
