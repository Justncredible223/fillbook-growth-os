import type { SupabaseClient } from "@supabase/supabase-js";
import { createLlmClient } from "../content/llmClient.js";
import { recordCostEvent } from "../cost/costTracking.js";
import { loadGroundingContext } from "../inbound/inboundHandlers.js";
import { selectDailyWorkingSet } from "./prospectingDailySelection.js";
import { STALE_EXPIRY_DAYS } from "./prospectingEligibility.js";
import { draftProspectingReply, PROSPECTING_TRACKABLE_LINK, type ProspectingDraftContext, type ProspectingDraftResult } from "./prospectingReplyWriter.js";
import { checkReplyGuardrails } from "../content/xReplyGuardrails.js";
import { buildTrackableReplyLink, substituteTrackableLink } from "../content/trackableLinks.js";
import { isPlausiblyTradingRelated } from "./prospectingRelevance.js";
import { discoveryLabelForKey, replyClassForKey } from "./prospectingTopics.js";
import { SupabaseProspectingRepository } from "./supabaseProspectingRepository.js";
import type { ProspectingCandidate, ProspectingRepository } from "./types.js";

export class ProspectingActionError extends Error {}

/**
 * Optional seams so the handlers can be exercised without a live Supabase
 * client or LLM: production callers pass nothing and get the real
 * repository + LLM-backed drafter; tests pass an in-memory repository and
 * a canned drafter. Nothing about the human-only posting boundary changes
 * -- neither seam can send anything anywhere.
 */
export interface ProspectingHandlerDeps {
  repo?: ProspectingRepository;
  drafter?: (context: ProspectingDraftContext, brandRulesSummary: string, verifiedKnowledgeSummary: string) => Promise<ProspectingDraftResult>;
  loadGrounding?: (client: SupabaseClient) => Promise<{ brandRulesSummary: string; verifiedKnowledgeSummary: string }>;
}

function repoFor(client: SupabaseClient, deps: ProspectingHandlerDeps): ProspectingRepository {
  return deps.repo ?? new SupabaseProspectingRepository(client);
}

/** Enriches a candidate with its human-readable topic label and reply class for the JSON response -- keeps discovery_query as the stable stored key while still giving the app something to display. */
export function toProspectingJson(candidate: ProspectingCandidate) {
  return {
    ...candidate,
    discoveryLabel: discoveryLabelForKey(candidate.discoveryQuery),
    replyClass: replyClassForKey(candidate.discoveryQuery),
  };
}

const NON_TERMINAL_STATUSES = ["new", "shown", "drafting", "ready"] as const;

/**
 * Why today's set looks the way it does -- added 2026-09-07 alongside the
 * freshness-decay/72h-cutoff changes specifically so an empty or small
 * daily set is never ambiguous. Before this existed, "Queue is clear" and
 * "everything's just too old right now" were indistinguishable from the
 * API response alone -- this makes that difference inspectable (and
 * testable) instead of silent. Counts are additive: totalConsidered ===
 * selected + deferred + belowQualityBar + tooOldForToday.
 */
export interface ProspectingSelectionDiagnostics {
  /** Every non-terminal (new/shown/drafting/ready) candidate examined this call, before any filtering. */
  totalConsidered: number;
  selected: number;
  /** Cleared the quality bar but lost to the one-per-author rule or the daily cap -- real backlog, not discarded. */
  deferred: number;
  /** Did not clear MIN_DAILY_SET_SCORE using today's freshness-adjusted effective score. */
  belowQualityBar: number;
  /** Excluded purely for being older than the 72h freshness cutoff -- see prospectingFreshness.ts. */
  tooOldForToday: number;
}

/**
 * DISCOVER -> FILTER -> RANK already happened upstream (prospectingSearch.ts
 * / prospectingScoring.ts). This is SELECT DAILY WORKING SET: expires
 * anything that's sat unactioned past STALE_EXPIRY_DAYS, re-ranks the
 * remaining non-terminal pool, and returns only today's capped, deduped
 * working set (see prospectingDailySelection.ts) -- never the full
 * accumulated backlog. Only rows actually selected today get marked
 * 'shown'; everything else stays exactly as it was (a 'new' row not
 * selected today is still 'new' tomorrow -- real backlog, not lost).
 *
 * Real, confirmed bug this closes (2026-09-07): the zero-cost relevance
 * gate in prospectingRelevance.ts previously only ran when the owner
 * tapped Draft reply on a candidate that had ALREADY been shown as an
 * actionable card (e.g. a crypto-only post like "$USELESS locked in the
 * profits... a 15% move in less than 2h" surfaced under a genuine-sounding
 * topic label). X's own search for a topic query is not a precise filter
 * (see prospectingSearch.ts), so off-topic results routinely make it into
 * the backlog; this is the one place every non-terminal candidate passes
 * through before ever becoming visible, so the gate is applied here too,
 * before daily selection -- an irrelevant candidate is moved straight to
 * 'not_relevant' (the same terminal status the owner's own "Irrelevant"
 * button sets, so the post itself is preserved, still visible in
 * Prospecting history, never deleted) and excluded from both the returned
 * candidates and the diagnostics below, exactly like it was never
 * discovered. This runs on every call (idempotent, $0, no LLM), so it also
 * retroactively sweeps any already-discovered irrelevant backlog the next
 * time the queue is fetched.
 */
export async function listProspectingQueue(
  client: SupabaseClient,
  now: Date = new Date(),
  deps: ProspectingHandlerDeps = {},
): Promise<{ candidates: ProspectingCandidate[]; diagnostics: ProspectingSelectionDiagnostics }> {
  const repo = repoFor(client, deps);

  const staleCutoff = new Date(now.getTime() - STALE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await repo.expireStale(staleCutoff);

  const nonTerminal = await repo.listByStatus([...NON_TERMINAL_STATUSES], 500);
  const irrelevantIds = nonTerminal.filter((row) => !isPlausiblyTradingRelated(row.postText)).map((row) => row.id);
  if (irrelevantIds.length > 0) {
    await Promise.all(irrelevantIds.map((id) => repo.updateStatus(id, "not_relevant")));
  }
  const eligible = irrelevantIds.length > 0 ? nonTerminal.filter((row) => !irrelevantIds.includes(row.id)) : nonTerminal;
  const { selected, deferred, belowQualityBar, tooOldForToday } = selectDailyWorkingSet(eligible, now);

  const newIds = selected.filter((c) => c.status === "new").map((c) => c.id);
  await repo.markShown(newIds);
  const candidates = selected.map((c) => (newIds.includes(c.id) ? { ...c, status: "shown" as const } : c));

  return {
    candidates,
    diagnostics: {
      totalConsidered: eligible.length,
      selected: selected.length,
      deferred: deferred.length,
      belowQualityBar: belowQualityBar.length,
      tooOldForToday: tooOldForToday.length,
    },
  };
}

export async function listProspectingHistory(client: SupabaseClient, limit = 100, deps: ProspectingHandlerDeps = {}): Promise<ProspectingCandidate[]> {
  const repo = repoFor(client, deps);
  return repo.listByStatus(["replied", "skipped", "not_relevant", "already_handled", "expired"], limit);
}

/**
 * Drafts exactly one reply for a human to review/edit/copy themselves --
 * same no-send guarantee as draftResponseForInbound. Persists the draft
 * and the model's own mentionsFillbook/usesLink flags (checked, not
 * assumed) so the app can show "this reply mentions Fillbook" honestly
 * before the owner even reads it. The candidate's own platform selects
 * the prompt profile.
 *
 * Two independent relevance gates close a real, confirmed bug (Prospecting
 * surfacing content with zero connection to futures/trading, and drafts
 * that admitted as much in their own reply text instead of refusing):
 * (1) prospectingRelevance.ts's mechanical, $0 pre-filter runs first --
 * an obviously irrelevant candidate never reaches the LLM at all; (2) the
 * model's own isRelevant flag (prospectingReplyWriter.ts) catches content
 * that slips past the keyword filter. Either gate failing moves the
 * candidate to 'not_relevant' (the same terminal status the owner's own
 * "Irrelevant" button sets) and throws before any draft is persisted or
 * returned -- the owner never sees a draft that says the post is
 * unrelated.
 */
export async function draftProspectingCandidateReply(client: SupabaseClient, id: string, deps: ProspectingHandlerDeps = {}): Promise<ProspectingCandidate> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);

  if (!isPlausiblyTradingRelated(row.postText)) {
    await repo.updateStatus(id, "not_relevant");
    throw new ProspectingActionError(
      "Not eligible for drafting -- this post doesn't appear to be about futures trading, prop-firm trading, or trading discipline.",
    );
  }

  const { brandRulesSummary, verifiedKnowledgeSummary } = await (deps.loadGrounding ?? loadGroundingContext)(client);
  const drafter =
    deps.drafter ??
    ((context: ProspectingDraftContext, brandRules: string, knowledge: string) => {
      const llmClient = createLlmClient(process.env, (usage) => {
        void recordCostEvent(client, usage, { prospectingCandidateId: id, endpoint: "prospecting-draft" }, "prospecting_llm_call");
      });
      return draftProspectingReply(llmClient, context, brandRules, knowledge);
    });

  const draft = await drafter(
    {
      platform: row.platform,
      authorHandle: row.authorHandle,
      postText: row.postText,
      discoveryQuery: row.discoveryQuery,
    },
    brandRulesSummary,
    verifiedKnowledgeSummary,
  );

  // Second, independent relevance gate -- the model's own honest judgment,
  // for content that slipped past the mechanical pre-filter above (e.g. a
  // post that uses real trading vocabulary but in a fundamentally
  // different, still-irrelevant context). Same terminal status and no
  // persisted draft as the pre-filter case.
  if (!draft.isRelevant) {
    await repo.updateStatus(id, "not_relevant");
    throw new ProspectingActionError("Not eligible for drafting -- the model judged this post isn't genuinely relevant to futures/trading.");
  }

  // Mechanical, $0 safety net -- catches banned generic phrases, an
  // unexplained link, and unverified performance/customer claims
  // regardless of what the model's own mentionsFillbook/usesLink flags
  // say. A violating draft is never persisted or shown to the owner.
  const violation = checkReplyGuardrails(draft.reply, draft.usesLink);
  if (violation) {
    throw new ProspectingActionError(`Draft rejected -- ${violation.reason}. Try drafting again.`);
  }

  // Swaps the model's static placeholder link for a real per-candidate
  // short link (see trackableLinks.ts) -- closes the "per-reply link
  // attribution isn't real yet" gap. A no-op when usesLink is false (the
  // common case), since the placeholder never appears in the reply then.
  const finalReply = draft.usesLink
    ? substituteTrackableLink(draft.reply, PROSPECTING_TRACKABLE_LINK, buildTrackableReplyLink(`prospecting:${id}`, "prospecting", id))
    : draft.reply;

  await repo.updateStatus(id, "ready", {
    draftReply: finalReply,
    replyMentionsFillbook: draft.mentionsFillbook,
    replyUsedLink: draft.usesLink,
  });

  const updated = await repo.getById(id);
  if (!updated) throw new ProspectingActionError(`Row "${id}" vanished after drafting`);
  return updated;
}

/** Records that the owner tapped "Copy + Open <platform>" -- doesn't change status, just timestamps it for staleness/analytics. */
export async function markProspectingOpened(client: SupabaseClient, id: string, deps: ProspectingHandlerDeps = {}): Promise<void> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, row.status, { openedAt: new Date().toISOString() });
}

/**
 * The one status a human, not this code, ever sets after actually posting
 * on the platform themselves -- mirrors markInboundResponded's contract
 * exactly (nothing here calls any X write endpoint; ExternalWriteFirewall
 * would reject it regardless). Also records outreach against the author IN
 * THE CANDIDATE'S OWN PLATFORM NAMESPACE so Inbound's
 * hasExistingRelationship check recognizes them if they reply back later
 * (see inboundIngestion.ts, which looks up outreach by platform).
 */
export async function markProspectingReplied(
  client: SupabaseClient,
  id: string,
  finalReply: string | undefined,
  mentionsFillbook: boolean | undefined,
  usedLink: boolean | undefined,
  deps: ProspectingHandlerDeps = {},
): Promise<ProspectingCandidate> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);

  const now = new Date().toISOString();
  await repo.updateStatus(id, "replied", {
    repliedAt: now,
    finalReply: finalReply && finalReply !== row.draftReply ? finalReply : undefined,
    replyMentionsFillbook: mentionsFillbook ?? row.replyMentionsFillbook ?? undefined,
    replyUsedLink: usedLink ?? row.replyUsedLink ?? undefined,
  });

  if (row.authorExternalId) {
    await repo.recordOutreach(row.platform, row.authorExternalId, row.authorHandle);
  }

  const updated = await repo.getById(id);
  if (!updated) throw new ProspectingActionError(`Row "${id}" vanished after marking replied`);
  return updated;
}

export async function markProspectingSkipped(client: SupabaseClient, id: string, reason: string | undefined, deps: ProspectingHandlerDeps = {}): Promise<void> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "skipped", { skipReason: reason ?? null });
}

export async function markProspectingNotRelevant(client: SupabaseClient, id: string, deps: ProspectingHandlerDeps = {}): Promise<void> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "not_relevant");
}

export async function markProspectingAlreadyHandled(client: SupabaseClient, id: string, deps: ProspectingHandlerDeps = {}): Promise<void> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "already_handled");
}
