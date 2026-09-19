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
    "trader typing on keyboard charts",
    "stock ticker screen scrolling",
    "futures market data screen",
    "trader reacting to stock chart",
    "trader stressed watching red chart",
    "day trader candlestick chart monitors",
    "stock trading screens night",
  ],
  explanation: [
    "stock market chart analysis",
    "trader reviewing market data",
    "financial chart trading strategy",
    "stock market trading screen",
    "trader annotating chart on tablet",
    "candlestick chart pattern closeup",
    "trading strategy whiteboard chart",
    "trader analyzing candlestick chart",
    "trader scrolling through stock charts",
    "trader explaining stock chart",
    "risk management trading chart screen",
    "day trader analyzing futures chart",
  ],
  metric: [
    "stock market green uptrend chart",
    "trading profit growth chart",
    "trading performance graph",
    "stock market gains chart",
    "profit and loss trading chart",
    "equity curve trading chart screen",
    "green candlestick rally chart",
    "stock market red candlestick chart falling",
    "stock market crash red chart",
    "trader losing money red chart",
    "trader winning trade green chart",
    "trading account balance chart",
  ],
  product: [
    "trader reviewing trade journal",
    "day trader analyzing trade data",
    "stock trader at desk charts",
    "futures trader monitor screens",
    "trader writing trading journal notes",
    "laptop trading journal stock chart",
    "trader reviewing past trades",
    "trader notebook stock chart desk",
    "trader tagging trade data",
    "trading dashboard on laptop",
    "trader reviewing trade history",
    "trader journaling trades at desk",
  ],
  cta: [
    "trader closing laptop trading desk",
    "trader smiling at stock market screen",
    "trader typing on keyboard stock charts",
    "stock market trading desk setup",
    "trader reviewing green candlestick chart",
    "stock trading monitor close up",
    "trader at multiple monitor trading desk",
    "stock market chart on laptop screen",
    "trading desk computer setup night",
    "trader scrolling stock market app phone",
    "trader celebrating winning trade chart",
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
   * means the provider gave us nothing to check, so the clip is rejected --
   * see filterTradingRelevant.
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
 * Relevance guard, added after real production renders showed off-topic
 * B-roll (a golf course, generic lifestyle/vacation footage) and tightened
 * again when generic footage kept slipping through: the first version
 * counted words like "office", "desk", "laptop", "screen", "business" and
 * "money" as trading evidence, so any "person typing on a laptop" clip
 * passed, and clips with no description at all were allowed. Both providers'
 * keyword search happily returns loosely-associated lifestyle footage, so
 * this is a real content gate, not a cosmetic filter.
 *
 * Two rules, both required:
 *   1. POSITIVE: the clip's own description must contain a strong,
 *      unambiguous trading/finance term (trader, stock, chart, candlestick,
 *      forex, futures, finance, nasdaq...). Generic setting words (office,
 *      desk, laptop, screen) are deliberately NOT enough on their own, and
 *      NEITHER is the bare word "market"/"markets" -- it's dropped from this
 *      list on purpose (see below).
 *   2. VETO: the description must not contain a known false-friend term
 *      ("farmers market", "supermarket", "street vendor", "livestock",
 *      "golf", "beach"...). A strong term can't override this, since
 *      "market" and "stock" are ambiguous words.
 *
 * "market"/"markets" was removed from the STRONG list after real renders
 * still showed food-market and street-vendor B-roll despite this filter:
 * "market" alone is too overloaded (farmers market, night market, flea
 * market, marketplace vendors...) for the veto list to ever fully
 * enumerate every non-finance phrasing. Genuine stock/futures-market
 * footage is essentially never described with "market" as the ONLY signal
 * word -- it's paired with "stock", "trading", "chart", "financial",
 * "equity" etc., all of which are still in this list, so dropping bare
 * "market" costs true positives only in the edge case where a clip's
 * entire description is a single ambiguous word.
 */
const STRONG_TRADING_PATTERN =
  /\b(trad(?:e|es|er|ers|ing)|stocks?|stock markets?|financial markets?|charts?|candlesticks?|forex|futures|crypto\w*|bitcoin|invest\w*|broker\w*|financ\w*|tickers?|portfolio|profits?|equity|equities|nasdaq|nyse|wall street|bullish|bearish)\b/;

const OFF_TOPIC_VETO_PATTERN =
  /\b(farmers?|flea|super ?markets?|grocery|groceries|fish|food|street ?(market|vendor|food)|market ?stalls?|marketplace\w*|vendors?|merchants?|bazaars?|souks?|kiosks?|hawkers?|peddlers?|produce|fruits?|vegetables?|seafood|spices?|grocers?|bakery|bakeries|butcher\w*|artisan\w*|night market|wet market|open[- ]?air market|livestock|cattle|golf\w*|beach|vacation|holiday|travel|tourist\w*|sunset|sunrise|nature|forest|mountain|wedding|party|dance|dancing|festival|family|kids?|children|baby|wildlife|animals?|dogs?|cats?|horses?|cooking|kitchen|fitness|gym|yoga|sports?|football|soccer|basketball|trade show|real estate|house|car|traffic|fashion|shopping|mall|casino|poker|gambling|slot)\b/;

/**
 * True only when `searchText` (a Pexels URL slug or Pixabay tag string --
 * see NormalizedVideoAsset's own doc comment) has a strong trading/markets
 * term AND no off-topic veto term. Exported for direct unit testing without
 * a live API call.
 */
export function isLikelyTradingRelevant(searchText: string): boolean {
  const lower = searchText.toLowerCase();
  if (OFF_TOPIC_VETO_PATTERN.test(lower)) return false;
  return STRONG_TRADING_PATTERN.test(lower);
}

/**
 * Applies isLikelyTradingRelevant to a full result set. An asset with NO
 * searchText is dropped: with no description there is no evidence the clip
 * is about trading, and showing an unverified clip is exactly how generic
 * off-topic footage reached rendered videos. An empty pool just means the
 * scene falls back to a solid brand-color card, which is the safe outcome.
 */
function filterTradingRelevant(assets: readonly NormalizedVideoAsset[]): NormalizedVideoAsset[] {
  return assets.filter((asset) => !!asset.searchText && isLikelyTradingRelevant(asset.searchText));
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
