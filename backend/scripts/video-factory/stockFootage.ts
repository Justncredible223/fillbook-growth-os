import { copyFileSync, createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { SceneKind } from "./types.js";

/**
 * Rotating Pexels search queries per scene kind.
 * The seed (derived from videoRenderId) picks a different query each render
 * so footage varies across videos on the same topic.
 */
const SCENE_QUERIES: Record<SceneKind, string[]> = {
  hook: [
    "futures day trader monitors",
    "stock market trading desk",
    "candlestick chart analysis",
    "trading screen charts",
  ],
  explanation: [
    "stock market analysis chart",
    "financial candlestick chart",
    "trader thinking analysis",
    "trading strategy planning",
  ],
  metric: [
    "stock market green chart",
    "trading profit graph",
    "financial performance data",
    "equity growth chart",
  ],
  product: [
    "trading journal app screen",
    "trader reviewing trade log",
    "stock trading dashboard monitor",
    "day trader analyzing trades",
  ],
  cta: [
    "phone stock trading app",
    "trader success profit",
    "futures trading win",
    "financial goals achievement",
  ],
};

export function getVideoQuery(kind: SceneKind, seed: number): string | null {
  const queries = SCENE_QUERIES[kind];
  if (!queries || queries.length === 0) return null;
  return queries[seed % queries.length];
}

interface PexelsVideoFile {
  quality: string;
  width: number;
  height: number;
  link: string;
  file_type: string;
}

interface PexelsVideo {
  id: number;
  duration: number;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

/**
 * Searches Pexels for a stock video clip matching `query`, downloads it to
 * `cacheDir`, and returns the local path. Returns null on any failure so the
 * caller can fall back to a solid-color background gracefully.
 *
 * Clips are cached by query slug — the same query across multiple scenes or
 * renders reuses the already-downloaded file without a network hit.
 */
export async function fetchStockClip(
  query: string,
  minDurationSeconds: number,
  cacheDir: string,
  apiKey: string,
): Promise<string | null> {
  try {
    mkdirSync(cacheDir, { recursive: true });

    const slug = query.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const cachePath = join(cacheDir, `${slug}.mp4`);

    // Return cached clip if it already exists
    try {
      statSync(cachePath);
      return cachePath;
    } catch {
      // Not cached yet
    }

    const searchUrl =
      `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape&size=medium`;

    const searchResp = await fetch(searchUrl, {
      headers: { Authorization: apiKey },
    });
    if (!searchResp.ok) return null;

    const data = (await searchResp.json()) as PexelsSearchResponse;
    if (!data.videos?.length) return null;

    // Prefer clips long enough to fill the scene; fall back to any clip
    const eligible = data.videos.filter((v) => v.duration >= minDurationSeconds);
    const pool = eligible.length > 0 ? eligible : data.videos;
    const video = pool[0];

    // Pick highest-quality MP4 file (hd > sd)
    const mp4Files = video.video_files.filter((f) => f.file_type === "video/mp4" || f.link.includes(".mp4"));
    const sorted = mp4Files.sort((a, b) => {
      const order: Record<string, number> = { hd: 0, sd: 1 };
      return (order[a.quality] ?? 9) - (order[b.quality] ?? 9);
    });
    const file = sorted[0];
    if (!file) return null;

    // Download the clip
    const dlResp = await fetch(file.link);
    if (!dlResp.ok || !dlResp.body) return null;

    const ws = createWriteStream(cachePath);
    await pipeline(dlResp.body as unknown as NodeJS.ReadableStream, ws);

    return cachePath;
  } catch {
    return null;
  }
}

/**
 * Copies a clip from `src` to `destDir/<basename>` if it doesn't already
 * exist there. Returns the destination path.
 */
export function copyClipToDir(src: string, destDir: string): string {
  const filename = src.split(/[\\/]/).pop()!;
  const dest = join(destDir, filename);
  try {
    statSync(dest);
  } catch {
    copyFileSync(src, dest);
  }
  return dest;
}
