import type { SupabaseClient } from "@supabase/supabase-js";
import { createLlmClient } from "../content/llmClient.js";
import { recordCostEvent } from "../cost/costTracking.js";
import { loadGroundingContext } from "../inbound/inboundHandlers.js";
import { selectDailyWorkingSet } from "./prospectingDailySelection.js";
import { STALE_EXPIRY_DAYS } from "./prospectingEligibility.js";
import { draftProspectingReply, type ProspectingDraftContext, type ProspectingDraftResult } from "./prospectingReplyWriter.js";
import { checkReplyGuardrails } from "../content/xReplyGuardrails.js";
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
 * Derives a "where this lives" label the drafter can use: the subreddit
 * for a Reddit permalink, nothing for X (an X post has no community).
 * Parsed from the stored postUrl rather than a separate column so no
 * schema change is needed; a URL that doesn't match simply yields null.
 */
export function communityLabelFor(candidate: Pick<ProspectingCandidate, "platform" | "postUrl">): string | null {
  if (candidate.platform.toLowerCase() !== "reddit") return null;
  const match = /\/r\/([A-Za-z0-9_]+)\//.exec(candidate.postUrl);
  return match ? `r/${match[1]}` : null;
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
 */
export async function listProspectingQueue(client: SupabaseClient, now: Date = new Date(), deps: ProspectingHandlerDeps = {}): Promise<ProspectingCandidate[]> {
  const repo = repoFor(client, deps);

  const staleCutoff = new Date(now.getTime() - STALE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  await repo.expireStale(staleCutoff);

  const eligible = await repo.listByStatus([...NON_TERMINAL_STATUSES], 500);
  const { selected } = selectDailyWorkingSet(eligible);

  const newIds = selected.filter((c) => c.status === "new").map((c) => c.id);
  await repo.markShown(newIds);
  return selected.map((c) => (newIds.includes(c.id) ? { ...c, status: "shown" as const } : c));
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
 * the prompt profile, so a Reddit thread is drafted as a Reddit comment
 * (and gets Reddit's stricter link policy), never as an X reply.
 */
export async function draftProspectingCandidateReply(client: SupabaseClient, id: string, deps: ProspectingHandlerDeps = {}): Promise<ProspectingCandidate> {
  const repo = repoFor(client, deps);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);

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
      communityLabel: communityLabelFor(row),
    },
    brandRulesSummary,
    verifiedKnowledgeSummary,
  );

  // Mechanical, $0 safety net -- catches banned generic phrases, an
  // unexplained link, and unverified performance/customer claims
  // regardless of what the model's own mentionsFillbook/usesLink flags
  // say. A violating draft is never persisted or shown to the owner.
  const violation = checkReplyGuardrails(draft.reply, draft.usesLink);
  if (violation) {
    throw new ProspectingActionError(`Draft rejected -- ${violation.reason}. Try drafting again.`);
  }

  await repo.updateStatus(id, "ready", {
    draftReply: draft.reply,
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
 * exactly (nothing here calls any X or Reddit write endpoint;
 * ExternalWriteFirewall would reject it regardless). Also records outreach
 * against the author IN THE CANDIDATE'S OWN PLATFORM NAMESPACE so
 * Inbound's hasExistingRelationship check recognizes them if they reply
 * back later (see inboundIngestion.ts / redditIngestion.ts, which each
 * look up outreach by their own platform). A Reddit reply recorded under
 * "x" would be invisible to the Reddit inbound bridge and would pollute
 * X's relationship data with a Reddit username.
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
