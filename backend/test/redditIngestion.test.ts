import { describe, it, expect } from "vitest";
import {
  ingestRedditInboundMentions,
  REDDIT_INBOUND_CURSOR_SOURCE,
  REDDIT_INBOX_MAX_PAGES_PER_RUN,
  encodeRedditInboundWatermark,
  parseRedditInboundWatermark,
} from "../src/inbound/redditIngestion";
import { InMemoryInboundRepository } from "../src/inbound/inMemoryInboundRepository";
import { InMemoryIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore";
import { REDDIT_INBOX_LIMIT_PER_RUN } from "../src/prospecting/redditEligibility";
import type { RedditInboxItem } from "../src/signals/adapters/redditAdapter";

function item(overrides: Partial<RedditInboxItem> & Pick<RedditInboxItem, "fullname" | "id" | "body">): RedditInboxItem {
  return {
    kind: "comment_reply",
    authorHandle: "someTrader",
    subreddit: "FuturesTrading",
    createdAt: new Date("2026-09-01T12:00:00Z"),
    parentFullname: "t1_parent",
    linkFullname: "t3_thread1",
    permalink: "https://www.reddit.com/r/FuturesTrading/comments/thread1/x/parent",
    wasComment: true,
    isUnread: true,
    ...overrides,
  };
}

/** Returns whatever it was given, regardless of paging -- fine for tests that only care about classification. */
class FakeRedditAdapter {
  constructor(private items: RedditInboxItem[]) {}
  async fetchInboxActivity(_after?: string, _limit?: number): Promise<RedditInboxItem[]> {
    return this.items;
  }
}

/**
 * Behaves like Reddit's real `/message/inbox` listing: newest-first, and
 * `after=<fullname>` returns the page that FOLLOWS that item (older
 * ones). Records every request so tests can assert on cursor usage.
 */
class ListingRedditAdapter {
  readonly calls: Array<{ after: string | undefined; limit: number }> = [];
  constructor(public inbox: RedditInboxItem[]) {}

  private sorted(): RedditInboxItem[] {
    return [...this.inbox].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  }

  async fetchInboxActivity(after?: string, limit = 25): Promise<RedditInboxItem[]> {
    this.calls.push({ after, limit });
    const listing = this.sorted();
    const start = after ? listing.findIndex((i) => i.fullname === after) + 1 : 0;
    if (after && start === 0) return []; // anchor vanished -- Reddit returns an empty slice
    return listing.slice(start, start + limit);
  }

  /** A reply arrives after the previous run. */
  arrive(newItem: RedditInboxItem) {
    this.inbox.push(newItem);
  }
}

function buildDeps(items: RedditInboxItem[], creatorHandles: string[] = []) {
  return {
    adapter: new FakeRedditAdapter(items) as any,
    repo: new InMemoryInboundRepository(),
    findCreatorIdByHandle: async (handle: string) => (creatorHandles.includes(handle) ? `creator-${handle}` : null),
  };
}

describe("ingestRedditInboundMentions", () => {
  const now = new Date("2026-09-01T13:00:00Z");

  it("inserts a fresh comment reply as p1/needs_response, platform=reddit", async () => {
    const deps = buildDeps([item({ fullname: "t1_1", id: "1", body: "how do you track drawdown?" })]);
    const cursors = new InMemoryIngestionCursorStore();

    const result = await ingestRedditInboundMentions(deps, cursors, now);

    expect(result).toEqual({ fetched: 1, inserted: 1, skippedExisting: 0, notActionable: 0, skippedBelowWatermark: 0 });
    const row = deps.repo.all()[0]!;
    expect(row.platform).toBe("reddit");
    expect(row.priority).toBe("p1_direct_reply");
    expect(row.status).toBe("needs_response");
  });

  it("preserves thread/parent context: linkFullname -> conversationId, parentFullname -> inReplyToExternalId", async () => {
    const deps = buildDeps([item({ fullname: "t1_1", id: "1", body: "great tool, thanks!", linkFullname: "t3_abc", parentFullname: "t1_parentXYZ" })]);
    const cursors = new InMemoryIngestionCursorStore();

    await ingestRedditInboundMentions(deps, cursors, now);

    const row = deps.repo.all()[0]!;
    expect(row.conversationId).toBe("t3_abc");
    expect(row.inReplyToExternalId).toBe("t1_parentXYZ");
  });

  it("dedupes on (platform, externalId=fullname) across repeated runs", async () => {
    const m = item({ fullname: "t1_1", id: "1", body: "solid post" });
    const deps = buildDeps([m]);
    const cursors = new InMemoryIngestionCursorStore();

    const first = await ingestRedditInboundMentions(deps, cursors, now);
    const second = await ingestRedditInboundMentions(deps, cursors, now);

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    // Same second as the stored mark -> re-submitted and deduped, never skipped blindly.
    expect(second.skippedExisting).toBe(1);
    expect(deps.repo.all()).toHaveLength(1);
  });

  it("a second reply in the same thread (link) after the first was responded lands as its own new needs_response row", async () => {
    const repo = new InMemoryInboundRepository();
    const cursors = new InMemoryIngestionCursorStore();
    const first = item({ fullname: "t1_1", id: "1", body: "question about pricing", linkFullname: "t3_thread" });
    await ingestRedditInboundMentions({ adapter: new FakeRedditAdapter([first]) as any, repo, findCreatorIdByHandle: async () => null }, cursors, now);
    await repo.updateStatus(repo.all()[0]!.id, "responded", { respondedAt: now.toISOString() });

    const followUp = item({ fullname: "t1_2", id: "2", body: "thanks, one more question", linkFullname: "t3_thread", createdAt: new Date("2026-09-01T12:30:00Z") });
    await ingestRedditInboundMentions({ adapter: new FakeRedditAdapter([followUp]) as any, repo, findCreatorIdByHandle: async () => null }, cursors, now);

    const rows = repo.all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.externalId === "t1_1")!.status).toBe("responded");
    expect(rows.find((r) => r.externalId === "t1_2")!.status).toBe("needs_response");
    expect(rows.find((r) => r.externalId === "t1_2")!.conversationId).toBe("t3_thread");
  });

  it("counts a private message as not-actionable and does not insert it as a public inbound row", async () => {
    const deps = buildDeps([item({ fullname: "t4_1", id: "1", body: "hey can you check my DM", kind: "private_message" })]);
    const cursors = new InMemoryIngestionCursorStore();

    const result = await ingestRedditInboundMentions(deps, cursors, now);

    expect(result.notActionable).toBe(1);
    expect(result.inserted).toBe(0);
    expect(deps.repo.all()).toHaveLength(0);
  });

  it("treats a username_mention (not a reply to us) with a question as p3_comment, not p1", async () => {
    const deps = buildDeps([item({ fullname: "t1_1", id: "1", body: "has anyone tried fillbook for journaling?", kind: "username_mention" })]);
    const cursors = new InMemoryIngestionCursorStore();

    await ingestRedditInboundMentions(deps, cursors, now);

    expect(deps.repo.all()[0]!.priority).toBe("p3_comment");
  });

  it("links a matched creator's handle and classifies as p2_relationship", async () => {
    const deps = buildDeps([item({ fullname: "t1_1", id: "1", body: "following up on our last chat", authorHandle: "knownCreator" })], ["knownCreator"]);
    const cursors = new InMemoryIngestionCursorStore();

    await ingestRedditInboundMentions(deps, cursors, now);

    const row = deps.repo.all()[0]!;
    expect(row.creatorId).toBe("creator-knownCreator");
    expect(row.priority).toBe("p2_relationship");
  });

  it("treats a prior Prospecting outreach as an existing relationship (p2)", async () => {
    const deps = {
      adapter: new FakeRedditAdapter([item({ fullname: "t1_1", id: "1", body: "hey thanks for the reply the other day", authorHandle: "randomTrader" })]) as any,
      repo: new InMemoryInboundRepository(),
      findCreatorIdByHandle: async () => null,
      hasProspectingOutreach: async (handle: string) => handle === "randomTrader",
    };
    const cursors = new InMemoryIngestionCursorStore();

    await ingestRedditInboundMentions(deps, cursors, now);

    expect(deps.repo.all()[0]!.priority).toBe("p2_relationship");
  });

  it("backlog recovery marks genuinely new items as review_needed and does not advance the cursor", async () => {
    const deps = buildDeps([item({ fullname: "t1_1", id: "1", body: "was this ever answered?" })]);
    const cursors = new InMemoryIngestionCursorStore();

    await ingestRedditInboundMentions(deps, cursors, now, true);

    expect(deps.repo.all()[0]!.status).toBe("review_needed");
    expect(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE)).toBeNull();
  });

  it("saves the newest item's timestamp as the Reddit-specific high-water mark, independent of X's own cursor", async () => {
    const deps = buildDeps([
      item({ fullname: "t1_300", id: "300", body: "newest", createdAt: new Date("2026-09-01T12:45:00Z") }),
      item({ fullname: "t1_299", id: "299", body: "older", createdAt: new Date("2026-09-01T12:00:00Z") }),
    ]);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("x_mention_inbound", "t1_999"); // a different platform's cursor -- must not be read or overwritten

    await ingestRedditInboundMentions(deps, cursors, now);

    expect(parseRedditInboundWatermark(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE))).toEqual({
      observedAt: new Date("2026-09-01T12:45:00Z"),
      fullname: "t1_300",
    });
    expect(await cursors.load("x_mention_inbound")).toBe("t1_999");
  });

  describe("sequential forward sync against a Reddit-shaped listing (regression for the wrong-direction `before` cursor)", () => {
    function listingDeps(adapter: ListingRedditAdapter) {
      return { adapter: adapter as any, repo: new InMemoryInboundRepository(), findCreatorIdByHandle: async () => null };
    }

    it("a reply that arrives after the first run is captured on the next run, and older items are never sent as the anchor", async () => {
      const adapter = new ListingRedditAdapter([
        item({ fullname: "t1_old", id: "old", body: "older reply", createdAt: new Date("2026-09-01T10:00:00Z") }),
        item({ fullname: "t1_mid", id: "mid", body: "middle reply", createdAt: new Date("2026-09-01T11:00:00Z") }),
      ]);
      const deps = listingDeps(adapter);
      const cursors = new InMemoryIngestionCursorStore();

      const first = await ingestRedditInboundMentions(deps, cursors, now);
      expect(first.inserted).toBe(2);

      adapter.arrive(item({ fullname: "t1_new", id: "new", body: "brand new reply", createdAt: new Date("2026-09-01T12:30:00Z") }));
      const second = await ingestRedditInboundMentions(deps, cursors, new Date("2026-09-01T13:30:00Z"));

      expect(second.inserted).toBe(1);
      // t1_old is strictly older than the mark -> skipped without a repo
      // round-trip. t1_mid CARRIES the mark (same second) -> re-submitted
      // and deduped, the deliberate same-second safety net.
      expect(second.skippedBelowWatermark).toBe(1);
      expect(second.skippedExisting).toBe(1);
      expect(deps.repo.all().map((r) => r.externalId).sort()).toEqual(["t1_mid", "t1_new", "t1_old"]);

      // Every request read from the TOP of the listing -- no run ever
      // anchored on a previously seen fullname, so a deleted/aged-out
      // item can never blank the feed.
      expect(adapter.calls.every((c) => c.after === undefined)).toBe(true);
      expect(adapter.calls.every((c) => !("before" in c))).toBe(true);
      expect(parseRedditInboundWatermark(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE))?.fullname).toBe("t1_new");
    });

    it("the mark advances monotonically: a run that sees nothing newer leaves it untouched, and a mid-listing item is never written back as the cursor", async () => {
      const adapter = new ListingRedditAdapter([
        item({ fullname: "t1_a", id: "a", body: "a", createdAt: new Date("2026-09-01T10:00:00Z") }),
        item({ fullname: "t1_b", id: "b", body: "b", createdAt: new Date("2026-09-01T11:00:00Z") }),
      ]);
      const deps = listingDeps(adapter);
      const cursors = new InMemoryIngestionCursorStore();

      await ingestRedditInboundMentions(deps, cursors, now);
      const afterFirst = await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE);

      const second = await ingestRedditInboundMentions(deps, cursors, new Date("2026-09-01T14:00:00Z"));
      const third = await ingestRedditInboundMentions(deps, cursors, new Date("2026-09-01T15:00:00Z"));

      expect(second.inserted + third.inserted).toBe(0);
      expect(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE)).toBe(afterFirst);
      expect(parseRedditInboundWatermark(afterFirst)?.fullname).toBe("t1_b");
    });

    it("still captures a new reply after the item carrying the mark was deleted from Reddit (the exact failure a fullname anchor has)", async () => {
      const adapter = new ListingRedditAdapter([item({ fullname: "t1_first", id: "first", body: "first", createdAt: new Date("2026-09-01T10:00:00Z") })]);
      const deps = listingDeps(adapter);
      const cursors = new InMemoryIngestionCursorStore();
      await ingestRedditInboundMentions(deps, cursors, now);

      adapter.inbox = adapter.inbox.filter((i) => i.fullname !== "t1_first"); // author deleted their comment
      adapter.arrive(item({ fullname: "t1_second", id: "second", body: "second", createdAt: new Date("2026-09-01T12:00:00Z") }));

      const result = await ingestRedditInboundMentions(deps, cursors, new Date("2026-09-01T13:00:00Z"));
      expect(result.inserted).toBe(1);
      expect(deps.repo.all().some((r) => r.externalId === "t1_second")).toBe(true);
    });

    it("pages older with `after` until it passes the mark when more than one page of new replies arrived, bounded by the page cap", async () => {
      const adapter = new ListingRedditAdapter([item({ fullname: "t1_base", id: "base", body: "base", createdAt: new Date("2026-09-01T00:00:00Z") })]);
      const deps = listingDeps(adapter);
      const cursors = new InMemoryIngestionCursorStore();
      await ingestRedditInboundMentions(deps, cursors, now);
      adapter.calls.length = 0;

      const burst = REDDIT_INBOX_LIMIT_PER_RUN + 5; // more than one page arrives between runs
      for (let i = 0; i < burst; i++) {
        adapter.arrive(item({ fullname: `t1_burst${i}`, id: `burst${i}`, body: `burst ${i}`, createdAt: new Date(Date.UTC(2026, 8, 1, 1, i)) }));
      }

      const result = await ingestRedditInboundMentions(deps, cursors, new Date("2026-09-01T13:00:00Z"));

      expect(result.inserted).toBe(burst);
      expect(adapter.calls).toHaveLength(2);
      expect(adapter.calls[0]!.after).toBeUndefined();
      // The second page is anchored on the LAST item of the first page -- walking older, never newer.
      expect(adapter.calls[1]!.after).toBe(`t1_burst${burst - REDDIT_INBOX_LIMIT_PER_RUN}`);
      expect(adapter.calls.length).toBeLessThanOrEqual(REDDIT_INBOX_MAX_PAGES_PER_RUN);
    });

    it("a legacy bare-fullname cursor from the pre-fix format is treated as 'no mark': reads the top page, dedupes, and rewrites a real mark", async () => {
      const adapter = new ListingRedditAdapter([item({ fullname: "t1_seen", id: "seen", body: "seen before", createdAt: new Date("2026-09-01T10:00:00Z") })]);
      const deps = listingDeps(adapter);
      await deps.repo.upsertIfNew({
        platform: "reddit",
        externalId: "t1_seen",
        conversationId: null,
        inReplyToExternalId: null,
        authorHandle: "someTrader",
        authorExternalId: "someTrader",
        creatorId: null,
        body: "seen before",
        inResponseToText: null,
        publicMetrics: {},
        priority: "p1_direct_reply",
        status: "responded",
        draftResponse: null,
        respondedAt: null,
        respondedNote: null,
        isRepeatEngager: false,
        observedAt: "2026-09-01T10:00:00.000Z",
        sourceReference: null,
      });
      const cursors = new InMemoryIngestionCursorStore();
      await cursors.save(REDDIT_INBOUND_CURSOR_SOURCE, "t1_seen"); // old format

      const result = await ingestRedditInboundMentions(deps, cursors, now);

      expect(result).toMatchObject({ inserted: 0, skippedExisting: 1, skippedBelowWatermark: 0 });
      expect(adapter.calls[0]!.after).toBeUndefined();
      expect(parseRedditInboundWatermark(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE))?.fullname).toBe("t1_seen");
    });
  });

  describe("watermark encoding", () => {
    it("round-trips", () => {
      const mark = { observedAt: new Date("2026-09-01T12:45:00.000Z"), fullname: "t1_abc" };
      expect(parseRedditInboundWatermark(encodeRedditInboundWatermark(mark))).toEqual(mark);
    });

    it("rejects garbage, empty, and legacy values instead of producing a bogus date", () => {
      expect(parseRedditInboundWatermark(null)).toBeNull();
      expect(parseRedditInboundWatermark("")).toBeNull();
      expect(parseRedditInboundWatermark("t1_abc")).toBeNull();
      expect(parseRedditInboundWatermark("not-a-date|t1_abc")).toBeNull();
      expect(parseRedditInboundWatermark("2026-09-01T12:45:00.000Z|")).toBeNull();
    });
  });
});
