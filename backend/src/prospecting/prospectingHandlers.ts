import type { SupabaseClient } from "@supabase/supabase-js";
import { createLlmClient } from "../content/llmClient.js";
import { recordCostEvent } from "../cost/costTracking.js";
import { loadGroundingContext } from "../inbound/inboundHandlers.js";
import { draftProspectingReply } from "./prospectingReplyWriter.js";
import { discoveryLabelForKey } from "./prospectingTopics.js";
import { SupabaseProspectingRepository } from "./supabaseProspectingRepository.js";
import type { ProspectingCandidate } from "./types.js";

export class ProspectingActionError extends Error {}

/** Enriches a candidate with its human-readable topic label for the JSON response -- keeps discovery_query as the stable stored key while still giving the app something to display. */
export function toProspectingJson(candidate: ProspectingCandidate) {
  return { ...candidate, discoveryLabel: discoveryLabelForKey(candidate.discoveryQuery) };
}

const QUEUE_STATUSES = ["new", "shown", "ready"] as const;

/** Lists the active queue (highest score first) and marks any still-'new' rows 'shown' -- a candidate is only ever presented once as "new," never resurfaced as if freshly found. */
export async function listProspectingQueue(client: SupabaseClient, limit = 50): Promise<ProspectingCandidate[]> {
  const repo = new SupabaseProspectingRepository(client);
  const queue = await repo.listByStatus([...QUEUE_STATUSES], limit);
  const newIds = queue.filter((c) => c.status === "new").map((c) => c.id);
  await repo.markShown(newIds);
  return queue.map((c) => (newIds.includes(c.id) ? { ...c, status: "shown" as const } : c));
}

export async function listProspectingHistory(client: SupabaseClient, limit = 100): Promise<ProspectingCandidate[]> {
  const repo = new SupabaseProspectingRepository(client);
  return repo.listByStatus(["replied", "skipped", "not_relevant", "already_handled", "expired"], limit);
}

/**
 * Drafts exactly one reply for a human to review/edit/copy themselves --
 * same no-send guarantee as draftResponseForInbound. Persists the draft
 * and the model's own mentionsFillbook/usesLink flags (checked, not
 * assumed) so the app can show "this reply mentions Fillbook" honestly
 * before the owner even reads it.
 */
export async function draftProspectingCandidateReply(client: SupabaseClient, id: string): Promise<ProspectingCandidate> {
  const repo = new SupabaseProspectingRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);

  const { brandRulesSummary, verifiedKnowledgeSummary } = await loadGroundingContext(client);
  const llmClient = createLlmClient(process.env, (usage) => {
    void recordCostEvent(client, usage, { prospectingCandidateId: id, endpoint: "prospecting-draft" });
  });

  const draft = await draftProspectingReply(
    llmClient,
    { authorHandle: row.authorHandle, postText: row.postText, discoveryQuery: row.discoveryQuery },
    brandRulesSummary,
    verifiedKnowledgeSummary,
  );

  await repo.updateStatus(id, "ready", {
    draftReply: draft.reply,
    replyMentionsFillbook: draft.mentionsFillbook,
    replyUsedLink: draft.usesLink,
  });

  const updated = await repo.getById(id);
  if (!updated) throw new ProspectingActionError(`Row "${id}" vanished after drafting`);
  return updated;
}

/** Records that the owner tapped "Open on X" -- doesn't change status, just timestamps it for staleness/analytics. */
export async function markProspectingOpened(client: SupabaseClient, id: string): Promise<void> {
  const repo = new SupabaseProspectingRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, row.status, { openedAt: new Date().toISOString() });
}

/**
 * The one status a human, not this code, ever sets after actually posting
 * on X themselves -- mirrors markInboundResponded's contract exactly
 * (nothing here calls any X write endpoint; ExternalWriteFirewall would
 * reject it regardless). Also records outreach against the author so
 * Inbound's hasExistingRelationship check recognizes them if they reply
 * back later (see inboundIngestion.ts) -- closing the loop the audit
 * flagged as missing.
 */
export async function markProspectingReplied(
  client: SupabaseClient,
  id: string,
  finalReply: string | undefined,
  mentionsFillbook: boolean | undefined,
  usedLink: boolean | undefined,
): Promise<ProspectingCandidate> {
  const repo = new SupabaseProspectingRepository(client);
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
    await repo.recordOutreach("x", row.authorExternalId, row.authorHandle);
  }

  const updated = await repo.getById(id);
  if (!updated) throw new ProspectingActionError(`Row "${id}" vanished after marking replied`);
  return updated;
}

export async function markProspectingSkipped(client: SupabaseClient, id: string, reason: string | undefined): Promise<void> {
  const repo = new SupabaseProspectingRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "skipped", { skipReason: reason ?? null });
}

export async function markProspectingNotRelevant(client: SupabaseClient, id: string): Promise<void> {
  const repo = new SupabaseProspectingRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "not_relevant");
}

export async function markProspectingAlreadyHandled(client: SupabaseClient, id: string): Promise<void> {
  const repo = new SupabaseProspectingRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new ProspectingActionError(`No prospecting_candidates row with id "${id}"`);
  await repo.updateStatus(id, "already_handled");
}
