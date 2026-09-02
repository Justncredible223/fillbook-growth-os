import { describe, it, expect } from "vitest";
import { ingestTikTokVideos } from "../src/signals/adapters/tiktokIngestion";
import { SignalGraph } from "../src/signals/signalGraph";
import { InMemorySignalRepository } from "../src/signals/inMemorySignalRepository";
import { InMemoryIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore";
import type { TikTokVideo } from "../src/signals/adapters/tiktokAdapter";

class FakeTikTokAdapter {
  public callCount = 0;

  constructor(private videos: TikTokVideo[]) {}

  async fetchOwnVideos(): Promise<TikTokVideo[]> {
    this.callCount++;
    return this.videos;
  }
}

function video(overrides: Partial<TikTokVideo>): TikTokVideo {
  return {
    videoId: "id",
    title: "title",
    createdAt: new Date("2026-08-31T10:00:00Z"),
    viewCount: 0,
    likeCount: 0,
    commentCount: 0,
    shareCount: 0,
    ...overrides,
  };
}

describe("ingestTikTokVideos", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ingests each video as a signal with no fabricated topic", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeTikTokAdapter([
      video({ videoId: "abc123", title: "Why 2 contracts is a bad rule", viewCount: 1000, likeCount: 50 }),
    ]);

    const signals = await ingestTikTokVideos(adapter as any, graph, cursors, now);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.source).toBe("tiktok_video");
    expect(signals[0]!.topic).toBeNull();
    expect(signals[0]!.observedAt).toEqual(new Date("2026-08-31T10:00:00Z"));
    expect(signals[0]!.sourceReference).toBe("https://www.tiktok.com/@fillbookhq/video/abc123");
    expect(signals[0]!.evidence).toEqual({
      videoId: "abc123",
      title: "Why 2 contracts is a bad rule",
      viewCount: 1000,
      likeCount: 50,
      commentCount: 0,
      shareCount: 0,
    });
  });

  it("fetches everything and filters client-side (no server-side since param)", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("tiktok_video", "2026-08-01T00:00:00.000Z");
    const adapter = new FakeTikTokAdapter([]);

    await ingestTikTokVideos(adapter as any, graph, cursors, now);

    expect(adapter.callCount).toBe(1);
  });

  it("filters out videos at or before the stored cursor", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("tiktok_video", "2026-08-25T00:00:00.000Z");
    const adapter = new FakeTikTokAdapter([
      video({ videoId: "old", createdAt: new Date("2026-08-20T00:00:00Z") }),
      video({ videoId: "new", createdAt: new Date("2026-08-31T00:00:00Z") }),
    ]);

    const signals = await ingestTikTokVideos(adapter as any, graph, cursors, now);

    expect(signals).toHaveLength(1);
    expect((signals[0]!.evidence as { videoId: string }).videoId).toBe("new");
  });

  it("saves the newest video's createdAt as the new cursor", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeTikTokAdapter([
      video({ videoId: "old", createdAt: new Date("2026-08-20T00:00:00Z") }),
      video({ videoId: "new", createdAt: new Date("2026-08-31T00:00:00Z") }),
    ]);

    await ingestTikTokVideos(adapter as any, graph, cursors, now);

    expect(await cursors.load("tiktok_video")).toBe("2026-08-31T00:00:00.000Z");
  });

  it("leaves the cursor unchanged when there are no new videos", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("tiktok_video", "2026-08-01T00:00:00.000Z");
    const adapter = new FakeTikTokAdapter([]);

    await ingestTikTokVideos(adapter as any, graph, cursors, now);

    expect(await cursors.load("tiktok_video")).toBe("2026-08-01T00:00:00.000Z");
  });
});
