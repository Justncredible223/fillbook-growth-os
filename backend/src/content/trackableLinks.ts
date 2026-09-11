/**
 * Per-reply trackable links -- closes the gap docs/PROSPECTING.md named
 * directly: "Per-reply link attribution isn't real yet." Prospecting and
 * Inbound previously handed out one static link (PROSPECTING_TRACKABLE_LINK
 * / INBOUND_TRACKABLE_LINK) shared by every reply, so a click could only
 * ever be attributed to "Prospecting in aggregate," never to which specific
 * reply earned it. This builds a per-candidate/per-engagement link through
 * the click-logging redirect added this session (api/ingest.ts?source=click,
 * backed by the link_clicks table), then callers string-replace the
 * static placeholder link in the model's own output with the real one --
 * the model never sees or generates the dynamic URL itself, so its own
 * link-policy judgment (whether a link belongs at all) is unaffected.
 *
 * Same "not a secret" reasoning as supabaseClient.ts's SUPABASE_URL --
 * this project's own public Vercel domain, safe to hardcode.
 */
const REDIRECT_BASE_URL = "https://fillbook-growth-os.vercel.app/api/ingest";

/**
 * Builds the public-facing short link for one reply. `linkKey` should be
 * unique per reply (e.g. "prospecting:<candidateId>", "inbound:<engagementId>")
 * so link_clicks rows are traceable back to the exact reply that earned
 * the click, not just the channel. `utmContent` is embedded in the target
 * URL so even a click that never resolves through this redirect (e.g. the
 * link gets copy-pasted elsewhere) still carries per-reply attribution in
 * the destination's own analytics.
 */
export function buildTrackableReplyLink(linkKey: string, utmMedium: string, utmContent: string): string {
  const target = `https://fillbookhq.com/?utm_source=x&utm_medium=${encodeURIComponent(utmMedium)}&utm_content=${encodeURIComponent(utmContent)}`;
  const params = new URLSearchParams({ source: "click", key: linkKey, to: target });
  return `${REDIRECT_BASE_URL}?${params.toString()}`;
}

/**
 * Replaces every occurrence of `placeholderLink` (the static link the
 * model was told to use, e.g. PROSPECTING_TRACKABLE_LINK) with the real
 * per-reply short link -- a no-op if the model didn't actually use the
 * link (usesLink=false, or it forgot to include it despite saying it
 * would), which is the common case since both writers default to no link.
 */
export function substituteTrackableLink(reply: string, placeholderLink: string, realLink: string): string {
  return reply.split(placeholderLink).join(realLink);
}
