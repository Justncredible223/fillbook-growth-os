import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Registrable-domain-ish normalization: lowercase, strip protocol/www/path/
 * query. Deliberately simple (no public-suffix-list lookup) -- good enough
 * to catch "https://www.CoachSite.com/about" vs "coachsite.com", not meant
 * to be bulletproof against every real-world alias (documented gap, see
 * the Partnerships plan's own Risks section).
 */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null; // an unparseable "URL" is never silently guessed at
  }
}

/** Lowercases and strips a leading "@" -- the same shape used across creators/prospecting/inbound handle columns. */
export function normalizeHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  const trimmed = handle.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

export interface ExistingMatch {
  source: "partnership_prospects" | "creators" | "prospecting" | "inbound";
  id: string;
  label: string;
}

/**
 * Cross-references a candidate domain/handle against every system that
 * already tracks outreach or relationships, so Partnerships can never
 * silently duplicate a contact another part of the app already knows
 * about, and can honor an existing do-not-contact/rejected signal.
 * Read-only; callers decide what to do with the matches (this never
 * blocks by itself).
 */
export async function findExistingMatches(
  client: SupabaseClient,
  candidate: { domain: string | null; handle: string | null },
): Promise<ExistingMatch[]> {
  const matches: ExistingMatch[] = [];
  if (!candidate.domain && !candidate.handle) return matches;

  if (candidate.domain || candidate.handle) {
    const filters = [
      candidate.domain ? `normalized_domain.eq.${candidate.domain}` : null,
      candidate.handle ? `normalized_handle.eq.${candidate.handle}` : null,
    ].filter((f): f is string => f !== null);
    const { data } = await client.from("partnership_prospects").select("id, organization_name").or(filters.join(","));
    for (const row of (data ?? []) as Array<{ id: string; organization_name: string }>) {
      matches.push({ source: "partnership_prospects", id: row.id, label: row.organization_name });
    }
  }

  if (candidate.handle) {
    const { data: creatorRows } = await client.from("creators").select("id, handle, platform").ilike("handle", candidate.handle);
    for (const row of (creatorRows ?? []) as Array<{ id: string; handle: string; platform: string }>) {
      matches.push({ source: "creators", id: row.id, label: `${row.handle} (${row.platform})` });
    }

    const { data: prospectingRows } = await client.from("prospecting_candidates").select("id, author_handle").ilike("author_handle", candidate.handle);
    for (const row of (prospectingRows ?? []) as Array<{ id: string; author_handle: string | null }>) {
      matches.push({ source: "prospecting", id: row.id, label: row.author_handle ?? candidate.handle });
    }

    const { data: inboundRows } = await client.from("inbound_engagements").select("id, author_handle").ilike("author_handle", candidate.handle);
    for (const row of (inboundRows ?? []) as Array<{ id: string; author_handle: string | null }>) {
      matches.push({ source: "inbound", id: row.id, label: row.author_handle ?? candidate.handle });
    }
  }

  return matches;
}
