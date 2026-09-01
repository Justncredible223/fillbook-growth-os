import { describe, it, expect } from "vitest";
import { ingestYouTubeVideos } from "../src/signals/adapters/youtubeIngestion";
import { SignalGraph } from "../src/signals/signalGraph";
import { InMemorySignalRepository } from "../src/signals/inMemorySignalRepository";
import { InMemoryIngestionCursorStore } from "../src/signals/adapters/ingestionCursorStore";
import type { YouTubeVideo } from "../src/signals/adapters/youtubeAdapter";

class FakeYouTubeAdapter {
  public lastPublishedAfter: string | undefined;

  constructor(private videos: YouTubeVideo[]) {}

  async fetchOwnVideos(publishedAfter?: string): Promise<YouTubeVideo[]> {
    this.lastPublishedAfter = publishedAfter;
    return this.videos;
  }
}

describe("ingestYouTubeVideos", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("ingests each video as a signal with no fabricated topic", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeYouTubeAdapter([
      { videoId: "abc123", title: "Why 2 contracts is a bad rule", publishedAt: new Date("2026-08-31T10:00:00Z") },
    ]);

    const signals = await ingestYouTubeVideos(adapter as any, graph, cursors, now);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.source).toBe("youtube_video");
    expect(signals[0]!.topic).toBeNull();
    expect(signals[0]!.observedAt).toEqual(new Date("2026-08-31T10:00:00Z"));
    expect(signals[0]!.sourceReference).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("passes the stored cursor as publishedAfter on the next call", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("youtube_video", "2026-08-01T00:00:00.000Z");
    const adapter = new FakeYouTubeAdapter([]);

    await ingestYouTubeVideos(adapter as any, graph, cursors, now);

    expect(adapter.lastPublishedAfter).toBe("2026-08-01T00:00:00.000Z");
  });

  it("saves the newest video's publishedAt as the new cursor", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    const adapter = new FakeYouTubeAdapter([
      { videoId: "old", title: "older video", publishedAt: new Date("2026-08-20T00:00:00Z") },
      { videoId: "new", title: "newest video", publishedAt: new Date("2026-08-31T00:00:00Z") },
    ]);

    await ingestYouTubeVideos(adapter as any, graph, cursors, now);

    expect(await cursors.load("youtube_video")).toBe("2026-08-31T00:00:00.000Z");
  });

  it("leaves the cursor unchanged when there are no new videos", async () => {
    const repo = new InMemorySignalRepository();
    const graph = new SignalGraph(repo);
    const cursors = new InMemoryIngestionCursorStore();
    await cursors.save("youtube_video", "2026-08-01T00:00:00.000Z");
    const adapter = new FakeYouTubeAdapter([]);

    await ingestYouTubeVideos(adapter as any, graph, cursors, now);

    expect(await cursors.load("youtube_video")).toBe("2026-08-01T00:00:00.000Z");
  });
});
