import type { RedditInboxItem, RedditSignalAdapter } from "../signals/adapters/redditAdapter.js";
import type { IngestionCursorStore } from "../signals/adapters/ingestionCursorStore.js";
import type { InboundRepository, NewInboundEngagement } from "./types.js";
import { classifyPriority } from "./inboundClassifier.js";
import { REDDIT_INBOX_LIMIT_PER_RUN } from "../prospecting/redditEligibility.js";

/** Own cursor, parallel to inboundIngestion.ts's INBOUND_CURSOR_SOURCE but Reddit-specific and independent -- a Reddit sync gap or reset can never skip or duplicate X's inbound queue, or vice versa. */
export const REDDIT_INBOUND_CURSOR_SOURCE = "reddit_inbound";

/**
 * Upper bound on how many inbox pages one forward-sync run will walk
 * while looking for the high-water mark. With REDDIT_INBOX_LIMIT_PER_RUN
 * items per page this caps a single run at 100 items -- far more than a
 * low-volume account sees between 3x/day pulses, while still bounding
 * the worst case (a very long outage) to a handful of cheap reads.
 * Anything older than the last page walked is picked up by the owner's
 * explicit backlog-recovery pass, never silently lost to a cursor jump.
 */
export const REDDIT_INBOX_MAX_PAGES_PER_RUN = 4;

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
  /** Items fetched but not processed because they are strictly older than the stored high-water mark -- i.e. the overlap a top-of-listing read always includes. Counted separately from skippedExisting so "how much of each run is genuinely new" stays measurable. */
  skippedBelowWatermark: number;
}

/**
 * The forward-sync high-water mark: the newest `created_utc` this
 * ingester has ever processed plus the fullname that carried it. Only
 * the timestamp drives the "is this new?" decision; the fullname is kept
 * for diagnostics and for exact-tie disambiguation of the item itself.
 */
export interface RedditInboundWatermark {
  observedAt: Date;
  fullname: string;
}

const WATERMARK_SEPARATOR = "|";

export function encodeRedditInboundWatermark(mark: RedditInboundWatermark): string {
  return `${mark.observedAt.toISOString()}${WATERMARK_SEPARATOR}${mark.fullname}`;
}

/**
 * Returns null for anything that isn't a valid encoded watermark --
 * including the pre-fix cursor format, which stored a bare fullname
 * ("t1_abc123"). A null here simply means "no usable watermark": the run
 * reads from the top of the inbox and relies on (platform, externalId)
 * dedupe, so upgrading never skips or duplicates anything.
 */
export function parseRedditInboundWatermark(raw: string | null | undefined): RedditInboundWatermark | null {
  if (!raw) return null;
  const separatorIndex = raw.indexOf(WATERMARK_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const observedAt = new Date(raw.slice(0, separatorIndex));
  const fullname = raw.slice(separatorIndex + 1);
  if (Number.isNaN(observedAt.getTime()) || fullname.length === 0) return null;
  return { observedAt, fullname };
}

/**
 * Pulls @fillbookhq's Reddit inbox (comment replies + username mentions +
 * private messages -- the one endpoint Reddit's API exposes for all
 * inbound activity, see redditAdapter.ts's doc comment) and turns each new
 * comment_reply/username_mention into a real inbound_engagements row,
 * platform="reddit" -- same table, same status lifecycle, same
 * dedupe-on-(platform,externalId) contract as X's inboundIngestion.ts.
 *
 * Forward sync uses a TIMESTAMP high-water mark, not a Reddit listing
 * anchor. Every run reads the inbox from the top (newest first) and keeps
 * paging older via `after` until it sees an item at or before the stored
 * mark (or runs out of items / hits REDDIT_INBOX_MAX_PAGES_PER_RUN).
 * Items strictly older than the mark are skipped without touching the
 * repository; items AT the mark's second are re-submitted and deduped,
 * because Reddit's created_utc is whole-second granularity and two
 * distinct items can share it. The mark then advances to the newest
 * timestamp seen. Unlike a `before=<fullname>` anchor, this can never be
 * invalidated by the anchor item being deleted or scrolling out of the
 * listing -- a newly arrived reply is always newer than the mark and is
 * always on the first page, so it cannot be missed.
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
 *
 * `backlogRecovery` ignores the mark entirely (reads one full top page,
 * re-submits everything, lands genuinely-new rows as "review_needed") and
 * never advances the mark -- same contract as X's backlog pass.
 */
export async function ingestRedditInboundMentions(
  deps: IngestRedditInboundDeps,
  cursorStore: IngestionCursorStore,
  now: Date = new Date(),
  backlogRecovery = false,
): Promise<IngestRedditInboundResult> {
  const watermark = backlogRecovery ? null : parseRedditInboundWatermark(await cursorStore.load(REDDIT_INBOUND_CURSOR_SOURCE));
  const items = await fetchUntilWatermark(deps.adapter, watermark, backlogRecovery, now);

  let inserted = 0;
  let skippedExisting = 0;
  let notActionable = 0;
  let skippedBelowWatermark = 0;
  let newest: RedditInboundWatermark | null = null;

  for (const item of items) {
    if (item.createdAt && (!newest || item.createdAt.getTime() > newest.observedAt.getTime())) {
      newest = { observedAt: item.createdAt, fullname: item.fullname };
    }
    if (watermark && item.createdAt && item.createdAt.getTime() < watermark.observedAt.getTime()) {
      skippedBelowWatermark++;
      continue;
    }
    if (item.kind !== "comment_reply" && item.kind !== "username_mention") {
      notActionable++;
      continue;
    }
    const row = await buildRow(deps, item, backlogRecovery, now);
    const result = await deps.repo.upsertIfNew(row);
    if (result.created) inserted++;
    else skippedExisting++;
  }

  // Advance only forward and only in forward-sync mode. An item with no
  // created_utc can never move the mark (nothing to compare against), and
  // a run that saw nothing newer leaves the stored mark exactly as it was
  // -- an older item is never written back as the "latest" position.
  if (!backlogRecovery && newest && (!watermark || newest.observedAt.getTime() > watermark.observedAt.getTime())) {
    await cursorStore.save(REDDIT_INBOUND_CURSOR_SOURCE, encodeRedditInboundWatermark(newest));
  }

  return { fetched: items.length, inserted, skippedExisting, notActionable, skippedBelowWatermark };
}

/**
 * Reads the inbox newest-first, one page at a time, stopping as soon as a
 * page contains an item at or before the watermark (everything after it
 * on later pages is older still). No watermark means a single top page:
 * that is the first-ever run or an upgrade from the old fullname cursor,
 * and the deliberately small first read matches the previous behaviour.
 */
async function fetchUntilWatermark(
  adapter: RedditSignalAdapter,
  watermark: RedditInboundWatermark | null,
  backlogRecovery: boolean,
  now: Date,
): Promise<RedditInboxItem[]> {
  const collected: RedditInboxItem[] = [];
  let after: string | undefined;

  for (let page = 0; page < REDDIT_INBOX_MAX_PAGES_PER_RUN; page++) {
    const pageItems = await adapter.fetchInboxActivity(after, REDDIT_INBOX_LIMIT_PER_RUN, now);
    collected.push(...pageItems);

    if (!watermark || backlogRecovery) break;
    if (pageItems.length < REDDIT_INBOX_LIMIT_PER_RUN) break; // last page
    const reachedWatermark = pageItems.some(
      (item) => item.fullname === watermark.fullname || (item.createdAt !== null && item.createdAt.getTime() <= watermark.observedAt.getTime()),
    );
    if (reachedWatermark) break;
    after = pageItems[pageItems.length - 1]!.fullname;
  }

  return collected;
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
