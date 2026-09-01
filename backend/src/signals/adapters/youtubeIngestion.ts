import type { SignalGraph } from "../signalGraph.js";
import type { Signal } from "../types.js";
import type { YouTubeAdapter } from "./youtubeAdapter.js";
import type { IngestionCursorStore } from "./ingestionCursorStore.js";

const CURSOR_SOURCE = "youtube_video";

/**
 * Pulls newly published videos on the owner's own channel. Cursor tracks
 * the newest video's publishedAt timestamp (ISO string) so repeated runs
 * only ingest videos published after the last check -- same pattern as
 * ingestXMentions's since_id. Filtering happens here, client-side, rather
 * than via YouTube's own publishedAfter param -- that param is broken
 * when combined with forMine=true (see youtubeAdapter.ts).
 */
export async function ingestYouTubeVideos(
  adapter: YouTubeAdapter,
  signalGraph: SignalGraph,
  cursorStore: IngestionCursorStore,
  now: Date = new Date(),
): Promise<Signal[]> {
  const cursor = await cursorStore.load(CURSOR_SOURCE);
  const sinceDate = cursor ? new Date(cursor) : null;
  const allVideos = await adapter.fetchOwnVideos(now);
  const videos = sinceDate ? allVideos.filter((v) => v.publishedAt > sinceDate) : allVideos;
  const signals: Signal[] = [];

  for (const video of videos) {
    const signal = await signalGraph.ingest(
      {
        source: CURSOR_SOURCE,
        topic: null,
        evidence: { videoId: video.videoId, title: video.title },
        observedAt: video.publishedAt,
        sourceReference: `https://www.youtube.com/watch?v=${video.videoId}`,
        privacyClassification: "public",
      },
      now,
    );
    signals.push(signal);
  }

  if (videos.length > 0) {
    const newest = videos.reduce((a, b) => (a.publishedAt > b.publishedAt ? a : b));
    await cursorStore.save(CURSOR_SOURCE, newest.publishedAt.toISOString());
  }

  return signals;
}
