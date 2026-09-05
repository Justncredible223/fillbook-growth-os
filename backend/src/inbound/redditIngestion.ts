import type { RedditInboxItem, RedditSignalAdapter } from "../signals/adapters/redditAdapter.js";
import type { IngestionCursorStore } from "../signals/adapters/ingestionCursorStore.js";
import type { InboundRepository, NewInboundEngagement } from "./types.js";
import { classifyPriority } from "./inboundClassifier.js";
import { REDDIT_INBOX_LIMIT_PER_RUN } from "../prospecting/redditEligibility.js";

/** Own cursor, parallel to inboundIngestion.ts's INBOUND_CURSOR_SOURCE but Reddit-specific and independent -- a Reddit sync gap or reset can never skip or duplicate X's inbound queue, or vice versa. */
export const REDDIT_INBOUND_CURSOR_SOURCE = "reddit_inbound";

export interface IngestRedditInboundDeps {
  adapter: RedditSignalAdapter;
  repo: InboundRepository;
  findCreatorIdByHandle: (handle: string) => Promise<string | null>;
  hasProspectingOutreach?: (authorHandle: string) => Promise<boolean>;
}

export interface IngestRedditInboundResult {
  fetched: number;
  inserted: number;
  skippedExisting: number;
  /** Inbox items Reddit returned that this ingester can't classify as an actionable engagement (e.g. a plain private message, which this app doesn't attempt to auto-triage as a public conversation) -- counted, not silently dropped, so a real gap in what's detectable stays visible rather than disappearing into "0 new." */
  notActionable: number;
}

/**
 * Pulls @fillbookhq's Reddit inbox (comment replies + username mentions +
 * private messages -- the one endpoint Reddit's API exposes for all
 * inbound activity, see redditAdapter.ts's doc comment) and turns each new
 * comment_reply/username_mention into a real inbound_engagements row,
 * platform="reddit" -- same table, same status lifecycle, same
 * dedupe-on-(platform,externalId) contract as X's inboundIngestion.ts.
 *
 * `linkFullname` (the submission a comment thread lives under) becomes
 * `conversationId`, so a second reply in the same thread is recognized as
 * the same conversation exactly like X's conversation_id does -- thread
 * context is preserved, not just the bare comment. `parentFullname`
 * becomes `inReplyToExternalId`, same purpose as X's referenced_tweets
 * "replied_to" id.
 *
 * Private messages (kind: "private_message") are recorded as "not
 * actionable" and skipped rather than inserted as a public-conversation
 * inbound row -- a DM has no public permalink/context to open and reply to
 * the way a comment reply does, and this app's whole reply workflow is
 * "copy draft, open the exact public conversation." Documented as a real
 * limitation, not silently dropped (see docs/REDDIT_INTEGRATION.md).
 */
export async function ingestRedditInboundMentions(
  deps: IngestRedditInboundDeps,
  cursorStore: IngestionCursorStore,
  now: Date = new Date(),
  backlogRecovery = false,
): Promise<IngestRedditInboundResult> {
  const before = backlogRecovery ? undefined : ((await cursorStore.load(REDDIT_INBOUND_CURSOR_SOURCE)) ?? undefined);
  const items = await deps.adapter.fetchInboxActivity(before, REDDIT_INBOX_LIMIT_PER_RUN, now);

  let inserted = 0;
  let skippedExisting = 0;
  let notActionable = 0;

  for (const item of items) {
    if (item.kind !== "comment_reply" && item.kind !== "username_mention") {
      notActionable++;
      continue;
    }
    const row = await buildRow(deps, item, backlogRecovery, now);
    const result = await deps.repo.upsertIfNew(row);
    if (result.created) inserted++;
    else skippedExisting++;
  }

  if (items.length > 0 && !backlogRecovery) {
    await cursorStore.save(REDDIT_INBOUND_CURSOR_SOURCE, items[0]!.fullname);
  }

  return { fetched: items.length, inserted, skippedExisting, notActionable };
}

async function buildRow(
  deps: IngestRedditInboundDeps,
  item: RedditInboxItem,
  backlogRecovery: boolean,
  now: Date,
): Promise<NewInboundEngagement> {
  const isDirectReplyToUs = item.kind === "comment_reply";
  const isQuotePost = false; // No Reddit equivalent to X's quote-post.

  const priorCount = item.authorHandle ? await deps.repo.countPriorFromAuthor("reddit", item.authorHandle) : 0;
  const creatorId = item.authorHandle ? await deps.findCreatorIdByHandle(item.authorHandle) : null;
  const priorProspectingOutreach =
    item.authorHandle && deps.hasProspectingOutreach ? await deps.hasProspectingOutreach(item.authorHandle) : false;
  const hasExistingRelationship = priorCount > 0 || creatorId !== null || priorProspectingOutreach;

  const priority = classifyPriority({
    text: item.body,
    isDirectReplyToUs,
    isQuotePost,
    hasExistingRelationship,
  });

  const status = priority === "low_value" ? "closed" : backlogRecovery ? "review_needed" : "needs_response";

  return {
    platform: "reddit",
    externalId: item.fullname,
    conversationId: item.linkFullname,
    inReplyToExternalId: item.parentFullname,
    authorHandle: item.authorHandle,
    authorExternalId: item.authorHandle,
    creatorId,
    body: item.body,
    inResponseToText: null, // Would need a second API call to fetch the parent comment/post's text -- not fetched yet, matching X inbound's same documented limitation.
    publicMetrics: {},
    priority,
    status,
    draftResponse: null,
    respondedAt: null,
    respondedNote: null,
    isRepeatEngager: priorCount > 0,
    observedAt: (item.createdAt ?? now).toISOString(),
    sourceReference: item.permalink,
  };
}
