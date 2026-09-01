import type { SignalGraph } from "../signalGraph.js";
import type { Signal } from "../types.js";
import type { YouTubeAdapter } from "./youtubeAdapter.js";
import type { IngestionCursorStore } from "./ingestionCursorStore.js";

const CURSOR_SOURCE = "youtube_video";

/**
 * Pulls newly published videos on the owner's own channel. Cursor tracks
 * the newest video's publishedAt timestamp (ISO string) so repeated runs
 * only fetch videos published after the last check -- same pattern as
 * ingestXMentions's since_id, adapted to YouTube's publishedAfter filter.
 */
export async function ingestYouTubeVideos(
  adapter: YouTubeAdapter,
  signalGraph: SignalGraph,
  cursorStore: IngestionCursorStore,
  now: Date = new Date(),
): Promise<Signal[]> {
  const publishedAfter = (await cursorStore.load(CURSOR_SOURCE)) ?? undefined;
  const videos = await adapter.fetchOwnVideos(publishedAfter, now);
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
