import { describe, it, expect } from "vitest";
import { ingestRedditInboundMentions, REDDIT_INBOUND_CURSOR_SOURCE } from "../src/inbound/redditIngestion";
import { InMemoryInboundRepository } from "../src/inbound/inMemoryInboundRepository";
import { InMemoryIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore";
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

class FakeRedditAdapter {
  constructor(private items: RedditInboxItem[]) {}
  async fetchInboxActivity(_before?: string, _limit?: number): Promise<RedditInboxItem[]> {
    return this.items;
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

    expect(result).toEqual({ fetched: 1, inserted: 1, skippedExisting: 0, notActionable: 0 });
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
    expect(second.skippedExisting).toBe(1);
    expect(deps.repo.all()).toHaveLength(1);
  });

  it("a second reply in the same thread (link) after the first was responded lands as its own new needs_response row", async () => {
    const repo = new InMemoryInboundRepository();
    const cursors = new InMemoryIngestionCursorStore();
    const first = item({ fullname: "t1_1", id: "1", body: "question about pricing", linkFullname: "t3_thread" });
    await ingestRedditInboundMentions({ adapter: new FakeRedditAdapter([first]) as any, repo, findCreatorIdByHandle: async () => null }, cursors, now);
    await repo.updateStatus(repo.all()[0]!.id, "responded", { respondedAt: now.toISOString() });

    const followUp = item({ fullname: "t1_2", id: "2", body: "thanks, one more question", linkFullname: "t3_thread" });
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

  it("saves the newest item's fullname as the Reddit-specific cursor, independent of X's own cursor", async () => {
    const deps = buildDeps([item({ fullname: "t1_300", id: "300", body: "newest" })]);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("x_mention_inbound", "t1_999"); // a different platform's cursor -- must not be read or overwritten

    await ingestRedditInboundMentions(deps, cursors, now);

    expect(await cursors.load(REDDIT_INBOUND_CURSOR_SOURCE)).toBe("t1_300");
    expect(await cursors.load("x_mention_inbound")).toBe("t1_999");
  });
});
