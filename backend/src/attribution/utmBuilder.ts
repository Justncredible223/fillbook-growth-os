/**
 * Attribution -- the honest, buildable slice of it. Real click-to-signup
 * attribution needs either FillbookHQ's own website to report back which
 * visits/signups came from which link, or Growth OS reading FillbookHQ's
 * production analytics directly -- neither exists, and this project has
 * no access to FillbookHQ's separate database by design (see
 * docs/ARCHITECTURE.md). What IS real and buildable now: giving every
 * handed-off draft a consistent, campaign_asset-tagged UTM suffix, so
 * that if/when real attribution access exists later, the tagging
 * convention is already in place rather than retrofitted. FillbookHQ
 * already has its own /go/ short-redirect system (see
 * fillbookhq/docs/CLAUDE_HANDOFF.md) -- this doesn't duplicate that, it
 * just standardizes the query string the owner appends to any Fillbook
 * link they include in the post.
 */
export interface UtmParams {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
}

function slugify(text: string, maxLength: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength) || "campaign";
}

export function buildUtmParams(campaignAssetId: string, platform: string, campaignThesis: string): UtmParams {
  return {
    utm_source: platform.toLowerCase(),
    utm_medium: "organic_social",
    utm_campaign: slugify(campaignThesis, 40),
    // Full asset ID, not slugified/truncated -- this is the join key back
    // to campaign_assets if real attribution ever becomes possible.
    utm_content: campaignAssetId,
  };
}

export function utmQueryString(params: UtmParams): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}
