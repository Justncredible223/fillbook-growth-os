import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hosts allowed as a link-click redirect target. Deliberately a strict
 * allowlist, not "any https URL" -- api/ingest.ts?source=click&to=... is a
 * public, unauthenticated GET endpoint (it has to be, real strangers on X
 * click it), so without this it would be an open redirect anyone could use
 * to disguise an arbitrary phishing link behind this project's own domain.
 */
const ALLOWED_REDIRECT_HOSTS = new Set(["fillbookhq.com", "www.fillbookhq.com"]);

export function isAllowedRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_REDIRECT_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export interface NewLinkClick {
  linkKey: string;
  targetUrl: string;
  referer: string | null;
  userAgent: string | null;
}

/**
 * Per-click log for a Growth-OS-issued short link, keyed by linkKey (the
 * specific prospecting reply / partnership outreach / content asset the
 * link was attached to) rather than only the aggregate utm_campaign the
 * link's target URL still separately carries. Closes the gap
 * docs/PROSPECTING.md named directly: "Per-reply link attribution isn't
 * real yet."
 */
export async function recordLinkClick(client: SupabaseClient, click: NewLinkClick): Promise<void> {
  const { error } = await client.from("link_clicks").insert({
    link_key: click.linkKey,
    target_url: click.targetUrl,
    referer: click.referer,
    user_agent: click.userAgent,
  });
  if (error) throw new Error(`Failed to record link click: ${error.message}`);
}
