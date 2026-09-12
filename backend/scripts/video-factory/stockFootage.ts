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
    "trader closing laptop trading desk",
    "trader smiling at stock market screen",
    "trader typing on keyboard stock charts",
    "stock market trading desk setup",
    "trader reviewing green candlestick chart",
    "financial trading monitor close up",
    "trader at multiple monitor trading desk",
    "stock market chart on laptop screen",
    "trading desk computer setup night",
    "trader scrolling stock market app phone",
    "financial data dashboard screen close up",
    "trader working at trading desk",
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
  /**
   * Free-text description of what's actually IN the clip, per provider (see
   * searchPexels/searchPixabay for where each comes from). Undefined/empty
   * means the provider gave us nothing to check -- see isLikelyTradingRelevant's
   * own doc comment for why that's treated as "allow" rather than "reject".
   */
  searchText?: string;
}

interface PexelsVideoFile {
  quality: string;
  link: string;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  /** e.g. "https://www.pexels.com/video/a-golfer-swinging-a-club-1234567/" -- Pexels' video API has no dedicated tags field, but the URL slug is a real, human-written description of the clip's actual content. */
  url?: string;
  video_files: PexelsVideoFile[];
}
interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

/** Turns a Pexels video URL's slug into space-separated words, e.g. ".../a-golfer-swinging-a-club-1234567/" -> "a golfer swinging a club". */
function pexelsUrlToSearchText(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const slug = url.replace(/\/$/, "").split("/").pop() ?? "";
  const withoutTrailingId = slug.replace(/-\d+$/, "");
  const words = withoutTrailingId.replace(/-/g, " ").trim();
  return words.length > 0 ? words : undefined;
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
    return [
      {
        provider: "pexels" as const,
        id: String(video.id),
        duration: video.duration,
        downloadUrl: file.link,
        searchText: pexelsUrlToSearchText(video.url),
      },
    ];
  });
}

interface PixabayVideoRendition {
  url: string;
  width: number;
}
interface PixabayVideoHit {
  id: number;
  duration: number;
  /** Comma-separated, e.g. "golf, sport, leisure" or "trading, finance, stock market" -- Pixabay's own uploader-supplied tags for the clip's actual content. */
  tags?: string;
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
    return [
      {
        provider: "pixabay" as const,
        id: String(hit.id),
        duration: hit.duration,
        downloadUrl: rendition.url,
        searchText: hit.tags && hit.tags.trim().length > 0 ? hit.tags.replace(/,/g, " ") : undefined,
      },
    ];
  });
}

/**
 * Keyword-based relevance guard, added after real production renders showed
 * completely off-topic B-roll (a golf course, generic lifestyle/vacation
 * footage of people with no connection to trading) -- both providers'
 * keyword search happily returns loosely-associated "success"/"achievement"/
 * "relaxed" stock footage for queries like "trader celebrating stock market
 * win" or "financial success city skyline", since those words alone don't
 * disambiguate from generic lifestyle B-roll. This is a real content-safety
 * gate for a video meant to only ever show trading/finance/office footage,
 * not a cosmetic filter.
 *
 * Deliberately an ALLOWLIST, not a blocklist: a blocklist can only ever name
 * categories already seen going wrong (golf today, something else
 * tomorrow), while an allowlist requires positive evidence the clip is
 * actually about trading, finance, markets, or a plausible office/desk/
 * screen setting before it's ever shown.
 */
const TRADING_RELEVANT_KEYWORDS = [
  "trad",
  "stock",
  "market",
  "financ",
  "chart",
  "invest",
  "broker",
  "forex",
  "crypto",
  "economy",
  "economic",
  "business",
  "office",
  "desk",
  "laptop",
  "computer",
  "screen",
  "monitor",
  "keyboard",
  "typing",
  "data",
  "graph",
  "money",
  "currency",
  "dollar",
  "candlestick",
  "portfolio",
  "spreadsheet",
  "analyst",
  "analytics",
];

/**
 * True when `searchText` (a Pexels URL slug or Pixabay tag string -- see
 * NormalizedVideoAsset's own doc comment) contains real, positive evidence
 * of trading/finance/office content. Exported for direct unit testing
 * without a live API call.
 */
export function isLikelyTradingRelevant(searchText: string): boolean {
  const lower = searchText.toLowerCase();
  return TRADING_RELEVANT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Applies isLikelyTradingRelevant to a full result set. An asset with no
 * searchText at all (a provider response missing the field entirely, e.g.
 * in tests, or a genuine gap in Pixabay's uploader-supplied tags) is kept
 * rather than rejected -- there's no positive evidence either way, and
 * rejecting on missing data would silently starve the pool for clips that
 * are perfectly fine but under-tagged. An asset WITH text that names
 * something else entirely (golf, a beach, a family gathering) is real
 * negative evidence and is dropped.
 */
function filterTradingRelevant(assets: readonly NormalizedVideoAsset[]): NormalizedVideoAsset[] {
  return assets.filter((asset) => !asset.searchText || isLikelyTradingRelevant(asset.searchText));
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
    // Relevance-filtered BEFORE duration eligibility, and never falls back
    // to the unfiltered pool when filtering empties it out -- an empty
    // result here correctly returns null below, which the caller already
    // treats as "no clip, fall back to a solid-color background" (see this
    // function's own doc comment). That's the right outcome: no clip is
    // strictly better than a real render showing an off-topic clip.
    const combined = filterTradingRelevant([...pexelsResults, ...pixabayResults]);
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
