import { describe, it, expect } from "vitest";
import { ingestXMentions } from "../src/signals/adapters/xIngestion";
import { SignalGraph } from "../src/signals/signalGraph";
import { InMemorySignalRepository } from "../src/signals/inMemorySignalRepository";
import { InMemoryIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore";
import type { XMention } from "../src/signals/adapters/xAdapter";

class FakeXAdapter {
  public lastSinceId: string | undefined;

  constructor(private mentions: XMention[]) {}

  async fetchOwnMentions(_userId: string, sinceId?: string): Promise<XMention[]> {
    this.lastSinceId = sinceId;
    return this.mentions;
  }
}

function mention(overrides: Partial<XMention> & Pick<XMention, "id" | "text">): XMention {
  return {
    authorId: null,
    authorHandle: null,
    createdAt: null,
    publicMetrics: null,
    inReplyToUserId: null,
    conversationId: null,
    referencedTweets: [],
    ...overrides,
  };
}

describe("ingestXMentions", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ingests each mention as a signal with no fabricated topic", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeXAdapter([
      mention({
        id: "1",
        text: "@FillbookHQ this journal is great",
        authorId: "42",
        createdAt: new Date("2026-09-01T09:00:00Z"),
        publicMetrics: { like_count: 5 },
      }),
    ]);

    const signals = await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.source).toBe("x_mention");
    expect(signals[0]!.topic).toBeNull();
    expect(signals[0]!.observedAt).toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(signals[0]!.sourceReference).toBe("https://x.com/i/web/status/1");
    expect(signals[0]!.evidence).toMatchObject({ postId: "1", text: "@FillbookHQ this journal is great" });
    expect(signals[0]!.privacyClassification).toBe("public");
  });

  it("falls back to `now` when a mention has no created_at", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeXAdapter([
      mention({ id: "2", text: "no timestamp" }),
    ]);

    const signals = await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(signals[0]!.observedAt).toEqual(now);
  });

  it("returns an empty array when there are no mentions", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeXAdapter([]);

    const signals = await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(signals).toEqual([]);
  });

  it("passes the stored cursor as since_id on the next call", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("x_mention", "100");
    const adapter = new FakeXAdapter([]);

    await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(adapter.lastSinceId).toBe("100");
  });

  it("saves the newest mention id (first in the response) as the new cursor", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeXAdapter([
      mention({ id: "300", text: "newest" }),
      mention({ id: "200", text: "older" }),
    ]);

    await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(await cursors.load("x_mention")).toBe("300");
  });

  it("leaves the cursor unchanged when there are no new mentions", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("x_mention", "100");
    const adapter = new FakeXAdapter([]);

    await ingestXMentions(adapter as any, graph, cursors, "own-user-id", now);

    expect(await cursors.load("x_mention")).toBe("100");
  });
});
