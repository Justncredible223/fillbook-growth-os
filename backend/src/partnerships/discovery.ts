import type { SupabaseClient } from "@supabase/supabase-js";
import type { XSignalAdapter } from "../signals/adapters/xAdapter.js";
import { recordPartnershipXSearchCostEvent } from "../cost/costTracking.js";
import { evaluatePartnershipBudget, getPartnershipMonthSpendUsd } from "./budget.js";
import { normalizeDomain, normalizeHandle, findExistingMatches } from "./dedup.js";
import { qualifyPartnership, createPartnership } from "./partnershipsHandlers.js";
import { DISCOVERY_TOPIC_KEYWORDS, rankCandidates, type DiscoveryCandidate } from "./discoveryScoring.js";
import type { PartnerCategory } from "./types.js";

/** Caps how much of the discovery run's budget any one run can spend -- see DISCOVERY_X_SEARCH_QUERIES below for what this actually buys (~$0.15-0.20/run at 3 queries x 10 results). */
const RESULTS_PER_QUERY = 10;
const MAX_NEW_CANDIDATES_PER_RUN = 10;
/** How many otherwise-qualifying-but-thin-evidence candidates get one per-handle enrichment lookup per run (see enrichThinCandidates) -- bounds the extra cost at MAX_ENRICHMENT_LOOKUPS * ENRICHMENT_RESULTS_PER_HANDLE * $0.005 (5 * 5 * $0.005 = $0.125/run). */
const MAX_ENRICHMENT_LOOKUPS = 5;
const ENRICHMENT_RESULTS_PER_HANDLE = 5;
/** How often the SCHEDULED (unforced) run is allowed to actually search -- an owner-triggered refresh (force=true) ignores this, but both respect MIN_INTERVAL_MINUTES below. */
const SCHEDULED_CADENCE_DAYS = 7;
/** Applies to every run, scheduled or forced -- prevents a rapid double-tap (or an overlapping scheduled+manual run) from burning budget twice for the same window. */
const MIN_INTERVAL_MINUTES = 60;

/** One real X search query per PartnerCategory that has a keyword group -- deliberately small (see this module's own budget-accounting doc comment in budget.ts). "other" has no dedicated query; it's reachable only via the existing-records sources. */
const DISCOVERY_X_SEARCH_QUERIES: Array<{ category: PartnerCategory; query: string }> = [
  { category: "educator_coach", query: "futures trading coach OR trading mentor" },
  { category: "creator_community", query: "futures trading community" },
  { category: "prop_firm", query: "prop firm mentorship OR funded trader program" },
];

function matchTopics(text: string): { topics: string[]; category: PartnerCategory | null } {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let bestCategory: PartnerCategory | null = null;
  for (const [category, keywords] of Object.entries(DISCOVERY_TOPIC_KEYWORDS) as Array<[PartnerCategory, string[]]>) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.push(kw);
        bestCategory ??= category;
      }
    }
  }
  return { topics: matched, category: bestCategory };
}

export interface DiscoveryRunResult {
  status: "found" | "no_matches" | "budget_exhausted" | "error" | "skipped_cadence";
  newCandidates: number;
  sourcesSearched: string[];
  costUsd: number;
  error?: string;
  skipReason?: string;
}

export interface PartnershipDiscoveryDeps {
  client: SupabaseClient;
  adapter?: XSignalAdapter | null;
  now?: Date;
  triggeredBy: "scheduled" | "owner";
  /** Bypasses SCHEDULED_CADENCE_DAYS (still respects MIN_INTERVAL_MINUTES and the budget gate). */
  force?: boolean;
}

async function lastRunAt(client: SupabaseClient): Promise<Date | null> {
  const { data } = await client.from("partnership_discovery_runs").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.created_at ? new Date(data.created_at as string) : null;
}

async function recordRun(
  client: SupabaseClient,
  triggeredBy: "scheduled" | "owner",
  result: Pick<DiscoveryRunResult, "status" | "newCandidates" | "sourcesSearched" | "costUsd" | "error">,
): Promise<void> {
  try {
    await client.from("partnership_discovery_runs").insert({
      triggered_by: triggeredBy,
      status: result.status === "skipped_cadence" ? "no_matches" : result.status,
      new_candidates: result.newCandidates,
      sources_searched: result.sourcesSearched,
      cost_usd: result.costUsd,
      error: result.error ?? null,
    });
  } catch {
    // Never let run-log bookkeeping fail the actual discovery work.
  }
}

/**
 * Existing-records sources -- zero additional cost, reuses data three
 * OTHER features already collected via their own authorized integrations.
 * Groups by author so a one-off mention doesn't look like a repeat
 * educator/community-owner presence.
 */
async function discoverFromCreators(client: SupabaseClient): Promise<DiscoveryCandidate[]> {
  const { data } = await client.from("creators").select("handle, display_name, platform, notes, creator_product_moment, last_interaction_at").eq("category", "tier_b");
  const rows = (data ?? []) as Array<{ handle: string; display_name: string | null; platform: string; notes: string | null; creator_product_moment: string | null; last_interaction_at: string | null }>;
  return rows.map((row) => {
    const text = [row.notes, row.creator_product_moment].filter(Boolean).join(" ");
    const { topics, category } = matchTopics(text);
    return {
      organizationName: row.display_name ?? row.handle,
      contactName: null,
      partnerCategory: category ?? "other",
      handle: row.platform === "x" ? normalizeHandle(row.handle) : null,
      websiteUrl: null,
      matchedTopics: topics,
      postsMatched: text.trim() ? 1 : 0,
      mostRecentMatchAt: row.last_interaction_at,
      sourceUrls: row.platform === "x" && row.handle ? [`https://x.com/${normalizeHandle(row.handle)}`] : [],
      discoveredVia: "creators" as const,
      rawExcerpts: text.trim() ? [text.trim()] : [],
    };
  });
}

async function discoverFromProspecting(client: SupabaseClient): Promise<DiscoveryCandidate[]> {
  const { data } = await client
    .from("prospecting_candidates")
    .select("author_handle, author_name, post_text, post_url, post_created_at")
    .not("author_handle", "is", null);
  const rows = (data ?? []) as Array<{ author_handle: string; author_name: string | null; post_text: string; post_url: string; post_created_at: string | null }>;
  const byHandle = new Map<string, { authorName: string | null; texts: string[]; urls: string[]; dates: string[] }>();
  for (const row of rows) {
    const handle = normalizeHandle(row.author_handle);
    if (!handle) continue;
    const entry = byHandle.get(handle) ?? { authorName: row.author_name, texts: [], urls: [], dates: [] };
    entry.texts.push(row.post_text);
    entry.urls.push(row.post_url);
    if (row.post_created_at) entry.dates.push(row.post_created_at);
    byHandle.set(handle, entry);
  }
  const candidates: DiscoveryCandidate[] = [];
  for (const [handle, entry] of byHandle) {
    const { topics, category } = matchTopics(entry.texts.join(" "));
    if (!category) continue; // no topic evidence at all -- not worth surfacing from raw prospecting noise
    candidates.push({
      organizationName: entry.authorName ?? `@${handle}`,
      contactName: entry.authorName,
      partnerCategory: category,
      handle,
      websiteUrl: null,
      matchedTopics: topics,
      postsMatched: entry.texts.length,
      mostRecentMatchAt: entry.dates.sort().at(-1) ?? null,
      sourceUrls: entry.urls.slice(0, 3),
      discoveredVia: "prospecting" as const,
      rawExcerpts: entry.texts.slice(0, 3),
    });
  }
  return candidates;
}

async function discoverFromInbound(client: SupabaseClient): Promise<DiscoveryCandidate[]> {
  const { data } = await client.from("inbound_engagements").select("author_handle, body, observed_at, source_reference").not("author_handle", "is", null);
  const rows = (data ?? []) as Array<{ author_handle: string; body: string; observed_at: string; source_reference: string | null }>;
  const byHandle = new Map<string, { texts: string[]; urls: string[]; dates: string[] }>();
  for (const row of rows) {
    const handle = normalizeHandle(row.author_handle);
    if (!handle) continue;
    const entry = byHandle.get(handle) ?? { texts: [], urls: [], dates: [] };
    entry.texts.push(row.body);
    if (row.source_reference) entry.urls.push(row.source_reference);
    entry.dates.push(row.observed_at);
    byHandle.set(handle, entry);
  }
  const candidates: DiscoveryCandidate[] = [];
  for (const [handle, entry] of byHandle) {
    const { topics, category } = matchTopics(entry.texts.join(" "));
    if (!category) continue;
    candidates.push({
      organizationName: `@${handle}`,
      contactName: null,
      partnerCategory: category,
      handle,
      websiteUrl: null,
      matchedTopics: topics,
      postsMatched: entry.texts.length,
      mostRecentMatchAt: entry.dates.sort().at(-1) ?? null,
      sourceUrls: entry.urls.slice(0, 3),
      discoveredVia: "inbound" as const,
      rawExcerpts: entry.texts.slice(0, 3),
    });
  }
  return candidates;
}

/** The one genuinely NEW public-source discovery this adds -- reuses the same authorized X search integration Prospecting already has, under Partnerships' own cost event type (see recordPartnershipXSearchCostEvent). */
async function discoverFromXSearch(adapter: XSignalAdapter, client: SupabaseClient, now: Date): Promise<{ candidates: DiscoveryCandidate[]; costUsd: number }> {
  const byHandle = new Map<string, { category: PartnerCategory; texts: string[]; urls: string[]; dates: string[]; authorName: string | null }>();
  let costUsd = 0;
  for (const { category, query } of DISCOVERY_X_SEARCH_QUERIES) {
    const results = await adapter.searchRecentPosts(query, RESULTS_PER_QUERY, now);
    costUsd += await recordPartnershipXSearchCostEvent(client, results.length, { query, category });
    for (const r of results) {
      const handle = normalizeHandle(r.authorHandle);
      if (!handle) continue;
      const entry = byHandle.get(handle) ?? { category, texts: [], urls: [], dates: [], authorName: r.authorName };
      entry.texts.push(r.text);
      entry.urls.push(`https://x.com/${handle}/status/${r.id}`);
      if (r.createdAt) entry.dates.push(r.createdAt.toISOString());
      byHandle.set(handle, entry);
    }
  }
  const candidates: DiscoveryCandidate[] = [];
  for (const [handle, entry] of byHandle) {
    const { topics } = matchTopics(entry.texts.join(" "));
    candidates.push({
      organizationName: entry.authorName ?? `@${handle}`,
      contactName: entry.authorName,
      partnerCategory: entry.category,
      handle,
      websiteUrl: null,
      matchedTopics: topics,
      postsMatched: entry.texts.length,
      mostRecentMatchAt: entry.dates.sort().at(-1) ?? null,
      sourceUrls: entry.urls.slice(0, 3),
      discoveredVia: "x_search" as const,
      rawExcerpts: entry.texts.slice(0, 3),
    });
  }
  return { candidates, costUsd };
}

/**
 * For candidates that already clear the qualifying bar (topic match,
 * score, contactability) but don't yet have enough of the recipient's
 * OWN words to personalize a pitch (see hasSufficientEvidenceForPitch),
 * do ONE targeted per-handle lookup (X's `from:` search operator, same
 * authorized integration, no new capability) to gather a few more of
 * their real recent posts. Bounded to MAX_ENRICHMENT_LOOKUPS candidates
 * per run so a batch of thin matches can't blow the budget. Mutates
 * candidate.rawExcerpts in place; callers must re-score afterward.
 */
async function enrichThinCandidates(
  adapter: XSignalAdapter | null | undefined,
  client: SupabaseClient,
  candidates: DiscoveryCandidate[],
  now: Date,
): Promise<{ enrichedCount: number; costUsd: number }> {
  if (!adapter) return { enrichedCount: 0, costUsd: 0 };
  let costUsd = 0;
  let enrichedCount = 0;
  for (const candidate of candidates) {
    if (enrichedCount >= MAX_ENRICHMENT_LOOKUPS) break;
    if (!candidate.handle) continue;
    if (candidate.rawExcerpts.join(" ").trim().length >= 30) continue; // already sufficient -- see MIN_PERSONALIZATION_CHARS
    try {
      const results = await adapter.searchRecentPosts(`from:${candidate.handle}`, ENRICHMENT_RESULTS_PER_HANDLE, now);
      costUsd += await recordPartnershipXSearchCostEvent(client, results.length, { enrichment: true, handle: candidate.handle });
      enrichedCount += 1;
      for (const r of results) {
        candidate.rawExcerpts.push(r.text);
        if (r.createdAt && (!candidate.mostRecentMatchAt || r.createdAt.toISOString() > candidate.mostRecentMatchAt)) {
          candidate.mostRecentMatchAt = r.createdAt.toISOString();
        }
      }
    } catch {
      // A per-candidate enrichment failure (rate limit, transient API error)
      // must never abort the whole run -- that candidate just stays thin,
      // same as if enrichment had never been attempted.
    }
  }
  return { enrichedCount, costUsd };
}

/**
 * The full discovery pipeline: gather candidates from every source,
 * dedupe against every existing record (partnership_prospects, creators,
 * prospecting, inbound -- including archived/do_not_contact rows, so a
 * dismissed lead never reappears), rank, cap, and create+qualify each
 * surviving candidate. Never auto-drafts a pitch and never marks anyone
 * contacted -- that stays a separate, later, owner-triggered action
 * (generateDraftForPartnership / markPartnershipContacted).
 *
 * Idempotent and safe to retry: every candidate is checked against
 * partnership_prospects (by normalized domain/handle) immediately before
 * insert, so a re-run (scheduled tick landing near a manual refresh, or a
 * retried request) can only ever skip already-known candidates, never
 * duplicate them.
 */
export async function runPartnershipDiscoveryStep(deps: PartnershipDiscoveryDeps): Promise<DiscoveryRunResult> {
  const { client } = deps;
  const now = deps.now ?? new Date();
  const force = deps.force ?? false;

  const last = await lastRunAt(client);
  if (last) {
    const minutesSinceLast = (now.getTime() - last.getTime()) / (1000 * 60);
    if (minutesSinceLast < MIN_INTERVAL_MINUTES) {
      const result: DiscoveryRunResult = { status: "skipped_cadence", newCandidates: 0, sourcesSearched: [], costUsd: 0, skipReason: `ran ${minutesSinceLast.toFixed(0)}m ago, minimum interval is ${MIN_INTERVAL_MINUTES}m` };
      return result;
    }
    const daysSinceLast = minutesSinceLast / (60 * 24);
    if (!force && daysSinceLast < SCHEDULED_CADENCE_DAYS) {
      const result: DiscoveryRunResult = { status: "skipped_cadence", newCandidates: 0, sourcesSearched: [], costUsd: 0, skipReason: `last scheduled run was ${daysSinceLast.toFixed(1)}d ago, cadence is every ${SCHEDULED_CADENCE_DAYS}d` };
      return result;
    }
  }

  const monthSpend = await getPartnershipMonthSpendUsd(client);
  const budgetCheck = evaluatePartnershipBudget(monthSpend);
  if (!budgetCheck.eligible) {
    const result: DiscoveryRunResult = { status: "budget_exhausted", newCandidates: 0, sourcesSearched: [], costUsd: 0, skipReason: budgetCheck.reason };
    await recordRun(client, deps.triggeredBy, result);
    return result;
  }

  const sourcesSearched: string[] = ["creators", "prospecting", "inbound"];
  let costUsd = 0;
  let allCandidates: DiscoveryCandidate[] = [];
  try {
    const [fromCreators, fromProspecting, fromInbound] = await Promise.all([
      discoverFromCreators(client),
      discoverFromProspecting(client),
      discoverFromInbound(client),
    ]);
    allCandidates = [...fromCreators, ...fromProspecting, ...fromInbound];

    if (deps.adapter) {
      const { candidates: fromXSearch, costUsd: xSearchCost } = await discoverFromXSearch(deps.adapter, client, now);
      allCandidates = [...allCandidates, ...fromXSearch];
      costUsd += xSearchCost;
      sourcesSearched.push("x_search");
    }
  } catch (err) {
    const result: DiscoveryRunResult = { status: "error", newCandidates: 0, sourcesSearched, costUsd, error: err instanceof Error ? err.message : String(err) };
    await recordRun(client, deps.triggeredBy, result);
    return result;
  }

  // First pass ranks on whatever evidence existing-records/x_search already
  // gathered; candidates that qualify but are too thin to personalize get
  // ONE targeted per-handle lookup before the real (final) ranking, rather
  // than qualifying them on category+recency alone and leaving the actual
  // pitch to fail the review gate for demonstrating no real knowledge of
  // the recipient (confirmed happening in production before this existed).
  const firstPassRanked = rankCandidates(allCandidates, now);
  const { enrichedCount, costUsd: enrichmentCost } = await enrichThinCandidates(
    deps.adapter,
    client,
    firstPassRanked.map((r) => r.candidate),
    now,
  );
  costUsd += enrichmentCost;
  if (enrichedCount > 0) sourcesSearched.push("x_search_enrichment");

  const ranked = rankCandidates(allCandidates, now);

  let created = 0;
  for (const rec of ranked) {
    if (created >= MAX_NEW_CANDIDATES_PER_RUN) break;
    const domain = normalizeDomain(rec.candidate.websiteUrl);
    const handle = rec.candidate.handle;
    const matches = await findExistingMatches(client, { domain, handle });
    if (matches.length > 0) continue; // already known somewhere -- including archived/do_not_contact rows in partnership_prospects itself

    // A candidate that qualifies (real topic match, decent score,
    // contactable) but still lacks enough of the recipient's own words
    // after enrichment is surfaced as a plain 'prospect' -- visible for
    // the owner to research further -- rather than 'qualified', which
    // reads as "ready to pursue" and would send every such candidate
    // straight into a doomed, budget-spending draft attempt.
    const { prospect } = await createPartnership(client, {
      organizationName: rec.candidate.organizationName,
      contactName: rec.candidate.contactName,
      partnerCategory: rec.candidate.partnerCategory,
      socialLinks: rec.candidate.handle ? { x: `https://x.com/${rec.candidate.handle}` } : {},
      contactRoute: rec.candidate.handle ? `X DM: @${rec.candidate.handle}` : null,
      contactRouteSource: rec.candidate.handle ? `Discovered via ${rec.candidate.discoveredVia}` : null,
      audienceFocus: rec.candidate.matchedTopics.length > 0 ? `Matched topics: ${rec.candidate.matchedTopics.join(", ")}` : null,
      futuresRelevanceEvidence: rec.sufficientForPitch ? rec.whyThisPartner : `${rec.whyThisPartner} ${rec.evidenceGap}`,
      sourceUrls: rec.candidate.sourceUrls,
      evidenceExcerpts: rec.candidate.rawExcerpts,
      researchDate: now.toISOString().slice(0, 10),
      proposedCollaboration: rec.suggestedCollaboration,
      qualificationRationale: rec.sufficientForPitch ? rec.whyThisPartner : null,
      discoveryScore: rec.score,
      discoveryConfidence: rec.confidence,
      discoveredVia: rec.candidate.discoveredVia,
    });
    if (rec.sufficientForPitch) {
      await qualifyPartnership(client, prospect.id, rec.whyThisPartner);
    }
    created += 1;
  }

  const result: DiscoveryRunResult = {
    status: created > 0 ? "found" : "no_matches",
    newCandidates: created,
    sourcesSearched,
    costUsd,
  };
  await recordRun(client, deps.triggeredBy, result);
  return result;
}
