import type { SupabaseClient } from "@supabase/supabase-js";
import { BrandConstitution } from "../knowledge/brandConstitution.js";
import { SupabaseBrandConstitutionRepository } from "../knowledge/supabaseRepositories.js";
import { createLlmClient } from "../content/llmClient.js";
import { recordCostEvent, estimateCostUsd } from "../cost/costTracking.js";
import { draftInboundResponse } from "./inboundResponseWriter.js";
import { SupabaseInboundRepository } from "./supabaseInboundRepository.js";
import { ingestInboundMentions } from "./inboundIngestion.js";
import { createXSignalAdapter } from "../signals/adapters/xAdapter.js";
import { SupabaseIngestionCursorStore } from "../signals/adapters/ingestionCursorStore.js";
import { findCreatorIdByHandle } from "../creators/supabaseCreatorRepository.js";
import { recordSyncAttempt, recordSyncSuccess, recordSyncFailure } from "../lib/integrationHealth.js";
import { errorMessage } from "../lib/errorMessage.js";
import type { InboundEngagement, InboundStatus } from "./types.js";

export class InboundActionError extends Error {}

const ACTIVE_STATUSES: InboundStatus[] = ["new", "needs_response", "draft_ready", "follow_up", "review_needed"];
const OVERDUE_HOURS = 48;

export interface InboundListItem extends InboundEngagement {
  creatorHandle: string | null;
  creatorCategory: string | null;
}

/**
 * Default view is the active queue (everything not yet resolved) --
 * matching the core requirement that nothing should require the owner to
 * remember to go looking for it. `includeResolved` exists for the
 * Content Library-style "everything, including history" view, not as
 * the default.
 */
export async function listInbound(client: SupabaseClient, includeResolved = false): Promise<InboundListItem[]> {
  const statuses: InboundStatus[] = includeResolved
    ? ["new", "needs_response", "draft_ready", "responded", "follow_up", "review_needed", "closed"]
    : ACTIVE_STATUSES;
  const repo = new SupabaseInboundRepository(client);
  const rows = await repo.listByStatus(statuses);

  const creatorIds = [...new Set(rows.map((r) => r.creatorId).filter((id): id is string => id !== null))];
  const creatorById = new Map<string, { handle: string; category: string }>();
  if (creatorIds.length > 0) {
    const { data } = await client.from("creators").select("id, handle, category").in("id", creatorIds);
    for (const row of (data ?? []) as Array<{ id: string; handle: string; category: string }>) {
      creatorById.set(row.id, { handle: row.handle, category: row.category });
    }
  }

  return rows.map((row) => ({
    ...row,
    creatorHandle: row.creatorId ? (creatorById.get(row.creatorId)?.handle ?? null) : null,
    creatorCategory: row.creatorId ? (creatorById.get(row.creatorId)?.category ?? null) : null,
  }));
}

export interface InboundSummary {
  needsResponse: number;
  followUp: number;
  repeatEngagers: number;
  overdue: number;
}

/**
 * The counts the Command Center dashboard shows -- "4 need response, 2
 * follow-ups, 1 repeat engager, 0 overdue." `overdue` is needs_response
 * items sitting longer than OVERDUE_HOURS with no draft and no response
 * -- the one number specifically meant to make it hard to forget
 * something for days.
 */
export async function summarizeInbound(client: SupabaseClient): Promise<InboundSummary> {
  const repo = new SupabaseInboundRepository(client);
  const active = await repo.listByStatus(ACTIVE_STATUSES);
  const cutoff = Date.now() - OVERDUE_HOURS * 60 * 60 * 1000;

  return {
    needsResponse: active.filter((r) => r.status === "needs_response" || r.status === "new").length,
    followUp: active.filter((r) => r.status === "follow_up").length,
    repeatEngagers: active.filter((r) => r.isRepeatEngager).length,
    overdue: active.filter(
      (r) => (r.status === "needs_response" || r.status === "new") && new Date(r.observedAt).getTime() < cutoff,
    ).length,
  };
}

async function loadGroundingContext(client: SupabaseClient): Promise<{ brandRulesSummary: string; verifiedKnowledgeSummary: string }> {
  const brandConstitution = new BrandConstitution(new SupabaseBrandConstitutionRepository(client));
  const activeRules = await brandConstitution.getActiveRules();
  const brandRulesSummary = activeRules.map((r) => `[${r.ruleType}] ${r.content}`).join("\n");

  const { data: knowledgeRows } = await client.from("knowledge_documents").select("title, content").eq("trust_level", "verified");
  const verifiedKnowledgeSummary = (knowledgeRows ?? [])
    .map((row: { title: string; content: string }) => `${row.title}: ${row.content}`)
    .join("\n");

  return { brandRulesSummary, verifiedKnowledgeSummary };
}

/**
 * Generates a draft and moves the row to 'draft_ready' -- deliberately a
 * DIFFERENT status than 'responded'. This function has no ability to
 * post anything anywhere; ExternalWriteFirewall would reject an
 * x.reply/x.post_tweet action regardless, but the more basic guarantee
 * is simpler than that -- there is no code here that calls any X write
 * endpoint at all.
 */
export async function draftResponseForInbound(client: SupabaseClient, id: string): Promise<InboundEngagement> {
  const repo = new SupabaseInboundRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new InboundActionError(`No inbound_engagements row with id "${id}"`);

  const { brandRulesSummary, verifiedKnowledgeSummary } = await loadGroundingContext(client);
  const llmClient = createLlmClient(process.env, (usage) => {
    void recordCostEvent(client, usage, { inboundEngagementId: id, endpoint: "inbound-draft" });
  });

  const draft = await draftInboundResponse(
    llmClient,
    {
      authorHandle: row.authorHandle,
      messageText: row.body,
      inResponseToText: row.inResponseToText,
      isRepeatEngager: row.isRepeatEngager,
      priorInteractionCount: await repo.countPriorFromAuthor(row.platform, row.authorExternalId ?? ""),
    },
    brandRulesSummary,
    verifiedKnowledgeSummary,
  );

  await repo.updateStatus(id, "draft_ready", { draftResponse: draft });
  return { ...row, status: "draft_ready", draftResponse: draft };
}

/**
 * The ONLY action that ever sets status='responded' -- an explicit,
 * human-triggered confirmation, never inferred from a draft existing.
 * X's API can't reliably confirm a reply was posted from this account
 * without an additional write-adjacent capability this app deliberately
 * doesn't have, so this is the safest available operator workflow: the
 * owner presses "Mark responded" after actually replying on X
 * themselves, same human-does-the-real-action pattern as Copy & Share.
 */
export async function markResponded(client: SupabaseClient, id: string, note?: string): Promise<void> {
  const repo = new SupabaseInboundRepository(client);
  const row = await repo.getById(id);
  if (!row) throw new InboundActionError(`No inbound_engagements row with id "${id}"`);
  await repo.updateStatus(id, "responded", { respondedAt: new Date().toISOString(), respondedNote: note?.trim() || null });
}

export async function markFollowUp(client: SupabaseClient, id: string): Promise<void> {
  const repo = new SupabaseInboundRepository(client);
  if (!(await repo.getById(id))) throw new InboundActionError(`No inbound_engagements row with id "${id}"`);
  await repo.updateStatus(id, "follow_up");
}

export async function closeInbound(client: SupabaseClient, id: string): Promise<void> {
  const repo = new SupabaseInboundRepository(client);
  if (!(await repo.getById(id))) throw new InboundActionError(`No inbound_engagements row with id "${id}"`);
  await repo.updateStatus(id, "closed");
}

/**
 * Manually triggers a wider-window inbound pull (ignores the stored
 * cursor) -- the "we found unanswered replies during a manual review"
 * recovery path. New items land as 'review_needed', not
 * 'needs_response': see ingestInboundMentions's doc comment for why.
 * Anything already tracked is left completely untouched.
 */
export async function runBacklogRecovery(client: SupabaseClient): Promise<{ fetched: number; inserted: number; skippedExisting: number }> {
  await recordSyncAttempt(client, "x_inbound");
  try {
    const adapter = createXSignalAdapter(client);
    const userId = await adapter.resolveOwnUserId();
    const repo = new SupabaseInboundRepository(client);
    const cursorStore = new SupabaseIngestionCursorStore(client);
    const result = await ingestInboundMentions(
      { adapter, repo, findCreatorIdByHandle: (handle) => findCreatorIdByHandle(client, handle) },
      cursorStore,
      userId,
      new Date(),
      true,
    );
    await recordSyncSuccess(client, "x_inbound", `backlog recovery: ${result.inserted} new, ${result.skippedExisting} already tracked`);
    return result;
  } catch (err) {
    await recordSyncFailure(client, "x_inbound", errorMessage(err));
    throw err;
  }
}
