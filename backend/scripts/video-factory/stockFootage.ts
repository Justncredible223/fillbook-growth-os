import { createWriteStream, mkdirSync, statSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { SceneKind } from "./types.js";

/**
 * Rotating stock-footage search queries per scene kind. Broadened
 * 2026-09-11 (from 4 to 12+ per kind) -- the real cause of "the videos all
 * use the same footage" wasn't which stock provider was behind this file,
 * it was this list being too narrow combined with fetchStockClip's old
 * behavior of keeping exactly one cached file per query, forever: with 4
 * queries/kind and always the first search result, every video ever
 * rendered could only ever show one of ~20 total clips site-wide. This
 * list is broader, and the caching/selection logic below no longer caps
 * each query at a single clip -- see pickRandomEligible and the
 * cache-by-clip-id (not by-query) scheme.
 */
const SCENE_QUERIES: Record<SceneKind, string[]> = {
  hook: [
    "futures trader multiple monitors",
    "day trader stock market desk",
    "stock market candlestick chart",
    "trader watching market charts",
    "trading floor screens close up",
    "forex trading dashboard",
    "trader typing on keyboard charts",
    "stock ticker screen scrolling",
    "futures market data screen",
    "trader desk night city view",
    "financial data wall screens",
    "trader reacting to charts",
  ],
  explanation: [
    "stock market chart analysis",
    "trader reviewing market data",
    "financial chart trading strategy",
    "stock market trading screen",
    "trader annotating chart on tablet",
    "candlestick chart pattern closeup",
    "trading strategy whiteboard",
    "financial analyst at desk",
    "trader scrolling through data",
    "market data spreadsheet screen",
    "trader explaining chart to camera",
    "risk management chart screen",
  ],
  metric: [
    "stock market green uptrend chart",
    "financial profit growth chart",
    "trading performance graph",
    "stock market gains chart",
    "profit and loss chart closeup",
    "equity curve chart screen",
    "percentage gain graphic",
    "financial growth arrow chart",
    "win rate statistics screen",
    "portfolio performance dashboard",
    "trading account balance growing",
    "green candlestick rally chart",
  ],
  product: [
    "trader reviewing trade journal",
    "day trader analyzing trade data",
    "stock trader at desk charts",
    "futures trader monitor screens",
    "trader writing notes at desk",
    "laptop trading journal screen",
    "trader reviewing past trades",
    "organized trading notebook desk",
    "trader tagging trade data",
    "trading dashboard on laptop",
    "trader filtering trade history",
    "desk setup trading journal app",
  ],
  cta: [
    "trader celebrating stock market win",
    "successful stock trader desk",
    "day trader financial success",
    "stock market trading achievement",
    "trader fist pump at desk",
    "confident trader smiling at screen",
    "trader closing laptop satisfied",
    "successful trading desk sunset",
    "trader shaking hands deal",
    "trader walking away from desk confident",
    "financial success city skyline",
    "trader relaxed after good day",
  ],
};

/** Deterministic per-render query pick (seeded, not random) -- keeps a given render's own scene-to-query mapping reproducible for debugging, while still varying across renders via the caller's seed. */
export function getVideoQuery(kind: SceneKind, seed: number): string | null {
  const queries = SCENE_QUERIES[kind];
  if (!queries || queries.length === 0) return null;
  return queries[seed % queries.length] ?? null;
}

/**
 * Both Pexels and Pixabay are free, self-serve APIs -- searched together
 * (not one-then-fallback) so the effective clip pool for any given query
 * is the union of both libraries, not whichever one happens to be tried
 * first. Either key may be omitted; fetchStockClip just searches whichever
 * providers have a key configured.
 */
export interface StockFootageCredentials {
  pexelsApiKey: string | null;
  pixabayApiKey: string | null;
}

/** One search result, normalized across providers so selection/caching logic never needs to know which API a clip came from. */
interface NormalizedVideoAsset {
  provider: "pexels" | "pixabay";
  id: string;
  duration: number;
  downloadUrl: string;
}

interface PexelsVideoFile {
  quality: string;
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

async function searchPexels(query: string, apiKey: string): Promise<NormalizedVideoAsset[]> {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape&size=medium`;
  const resp = await fetch(url, { headers: { Authorization: apiKey } });
  if (!resp.ok) return [];
  const data = (await resp.json()) as PexelsSearchResponse;
  return (data.videos ?? []).flatMap((video) => {
    const mp4Files = video.video_files.filter((f) => f.file_type === "video/mp4" || f.link.includes(".mp4"));
    const sorted = mp4Files.sort((a, b) => {
      const order: Record<string, number> = { hd: 0, sd: 1 };
      return (order[a.quality] ?? 9) - (order[b.quality] ?? 9);
    });
    const file = sorted[0];
    if (!file) return [];
    return [{ provider: "pexels" as const, id: String(video.id), duration: video.duration, downloadUrl: file.link }];
  });
}

interface PixabayVideoRendition {
  url: string;
  width: number;
}
interface PixabayVideoHit {
  id: number;
  duration: number;
  videos: { large: PixabayVideoRendition; medium: PixabayVideoRendition; small: PixabayVideoRendition };
}
interface PixabaySearchResponse {
  hits: PixabayVideoHit[];
}

async function searchPixabay(query: string, apiKey: string): Promise<NormalizedVideoAsset[]> {
  const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(query)}&safesearch=true`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  const data = (await resp.json()) as PixabaySearchResponse;
  return (data.hits ?? []).flatMap((hit) => {
    // Prefer "medium" (1920x1080 or 1280x720) over "large" (often 3840x2160,
    // unnecessarily big for a 1080-wide vertical render crop) -- falls back
    // to whichever rendition actually has a URL.
    const rendition = hit.videos?.medium?.url ? hit.videos.medium : hit.videos?.large?.url ? hit.videos.large : hit.videos?.small;
    if (!rendition?.url) return [];
    return [{ provider: "pixabay" as const, id: String(hit.id), duration: hit.duration, downloadUrl: rendition.url }];
  });
}

/**
 * Picks a random eligible result rather than always the first (the old
 * Pexels-only integration's behavior) -- this is what actually makes
 * footage vary across renders that happen to search the same query, since
 * the cache below is keyed by the resulting clip's (provider, id), not the
 * query text.
 */
export function pickRandomEligible<T extends { duration: number }>(items: readonly T[], minDurationSeconds: number): T | null {
  if (items.length === 0) return null;
  const eligible = items.filter((v) => v.duration >= minDurationSeconds);
  const pool = eligible.length > 0 ? eligible : items;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * Searches Pexels and Pixabay together for a stock video clip matching
 * `query`, downloads it to `cacheDir`, and returns the local path. Returns
 * null on any failure (including both providers returning nothing) so the
 * caller can fall back to a solid-color background gracefully.
 *
 * Clips are cached by `<provider>-<id>.mp4` (not by search query) -- the
 * same query resolving to a different random result on a later render
 * adds a NEW cache entry instead of overwriting a single per-query slot,
 * so the cache grows a real library of distinct clips over many renders
 * instead of capping at one clip per query forever (see this file's own
 * top-of-file comment on the actual root cause of "always the same
 * footage" this replaces).
 */
export async function fetchStockClip(
  query: string,
  minDurationSeconds: number,
  cacheDir: string,
  credentials: StockFootageCredentials,
): Promise<string | null> {
  try {
    mkdirSync(cacheDir, { recursive: true });

    const [pexelsResults, pixabayResults] = await Promise.all([
      credentials.pexelsApiKey ? searchPexels(query, credentials.pexelsApiKey).catch(() => []) : Promise.resolve([]),
      credentials.pixabayApiKey ? searchPixabay(query, credentials.pixabayApiKey).catch(() => []) : Promise.resolve([]),
    ]);
    const combined = [...pexelsResults, ...pixabayResults];
    if (combined.length === 0) return null;

    const asset = pickRandomEligible(combined, minDurationSeconds);
    if (!asset) return null;

    const cachePath = join(cacheDir, `${asset.provider}-${asset.id}.mp4`);
    try {
      statSync(cachePath);
      return cachePath;
    } catch {
      // Not cached yet -- download below.
    }

    const dlResp = await fetch(asset.downloadUrl);
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
