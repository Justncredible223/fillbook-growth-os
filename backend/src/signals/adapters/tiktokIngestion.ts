import type { SignalGraph } from "../signalGraph.js";
import type { Signal } from "../types.js";
import type { TikTokAdapter } from "./tiktokAdapter.js";
import type { IngestionCursorStore } from "./ingestionCursorStore.js";

const CURSOR_SOURCE = "tiktok_video";

/**
 * Pulls newly published videos on the owner's own TikTok account, same
 * shape as ingestYouTubeVideos: cursor tracks the newest video's
 * createdAt timestamp (ISO string) so repeated runs only ingest videos
 * published after the last check. Filtering happens client-side rather
 * than via a server-side "since" param -- TikTok's video.list has no
 * such filter, only cursor-based pagination through the full list.
 *
 * Engagement metrics (views/likes/comments/shares) ride along as
 * evidence, same as X's publicMetrics -- useful for opportunity scoring
 * once that reads from evidence, not fabricated or estimated here.
 */
export async function ingestTikTokVideos(
  adapter: TikTokAdapter,
  signalGraph: SignalGraph,
  cursorStore: IngestionCursorStore,
  now: Date = new Date(),
): Promise<Signal[]> {
  const cursor = await cursorStore.load(CURSOR_SOURCE);
  const sinceDate = cursor ? new Date(cursor) : null;
  const allVideos = await adapter.fetchOwnVideos(now);
  const videos = sinceDate ? allVideos.filter((v) => v.createdAt > sinceDate) : allVideos;
  const signals: Signal[] = [];

  for (const video of videos) {
    const signal = await signalGraph.ingest(
      {
        source: CURSOR_SOURCE,
        topic: null,
        evidence: {
          videoId: video.videoId,
          title: video.title,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          commentCount: video.commentCount,
          shareCount: video.shareCount,
        },
        observedAt: video.createdAt,
        sourceReference: `https://www.tiktok.com/@fillbookhq/video/${video.videoId}`,
        privacyClassification: "public",
      },
      now,
    );
    signals.push(signal);
  }

  if (videos.length > 0) {
    const newest = videos.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    await cursorStore.save(CURSOR_SOURCE, newest.createdAt.toISOString());
  }

  return signals;
}
