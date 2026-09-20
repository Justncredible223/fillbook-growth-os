import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getSceneQuery, getVideoQuery, pickRandomEligible, fetchStockClip, isLikelyTradingRelevant } from "../../scripts/video-factory/stockFootage";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}
function downloadResponse() {
  return { ok: true, body: Readable.from(["fake video bytes"]) } as unknown as Response;
}

describe("getVideoQuery", () => {
  it("rotates deterministically through the query list for a given scene kind", () => {
    const seenAcrossFirstCycle = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      const query = getVideoQuery("hook", seed);
      expect(query).not.toBeNull();
      seenAcrossFirstCycle.add(query!);
    }
    // Broadened 2026-09-11 from 4 to 12+ queries per kind -- a full cycle
    // of 12 seeds should surface a real variety, not the same 1-4 phrases
    // repeating, which was the actual root cause of "always the same
    // footage" independent of which stock provider is behind this file.
    expect(seenAcrossFirstCycle.size).toBeGreaterThanOrEqual(10);
  });

  it("is deterministic -- the same (kind, seed) always returns the same query", () => {
    expect(getVideoQuery("metric", 7)).toBe(getVideoQuery("metric", 7));
  });

  it("every scene kind has a real, non-empty query list", () => {
    const kinds: Array<Parameters<typeof getVideoQuery>[0]> = ["hook", "explanation", "metric", "product", "cta"];
    for (const kind of kinds) {
      expect(getVideoQuery(kind, 0)).not.toBeNull();
    }
  });
});

describe("getSceneQuery", () => {
  const kind = "explanation" as const;

  it("matches footage to what is being said, not just the scene kind", () => {
    expect(getSceneQuery({ kind, narration: "you revenge traded after a loss", shot: "Trader at desk" }, 0)).toMatch(/red|stress|losing|crash|frustrat/);
    expect(getSceneQuery({ kind, narration: "a winning streak and a payout", shot: "" }, 0)).toMatch(/win|green|gain|profit/);
    expect(getSceneQuery({ kind, narration: "log every trade and review the pattern", shot: "" }, 0)).toMatch(/journal|review|notebook/);
  });

  it("falls back to the scene kind's rotation when nothing specific is being said", () => {
    expect(getSceneQuery({ kind, narration: "and that is exactly why", shot: "Text card" }, 3)).toBe(getVideoQuery(kind, 3));
    expect(getSceneQuery({ kind }, 5)).toBe(getVideoQuery(kind, 5));
  });

  it("checks the more specific emotional concepts before the generic chart ones", () => {
    expect(getSceneQuery({ kind, narration: "staring at the screen after a loss", shot: "" }, 0)).toMatch(/red|stress|losing|crash|frustrat/);
  });

  it("is deterministic and rotates with the seed", () => {
    const text = { kind, narration: "review the pattern", shot: "" };
    expect(getSceneQuery(text, 2)).toBe(getSceneQuery(text, 2));
    const seen = new Set([0, 1, 2, 3].map((seed) => getSceneQuery(text, seed)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("does not treat a word merely containing a keyword as a match", () => {
    expect(getSceneQuery({ kind, narration: "a stopwatch and a fossil", shot: "" }, 0)).toBe(getVideoQuery(kind, 0));
  });

  it("every concept query would pass the trading-relevance filter's own vocabulary", () => {
    for (const narration of ["revenge loss", "winning payout", "journal review", "rules plan", "position size risk", "entry setup"]) {
      const query = getSceneQuery({ kind, narration }, 0)!;
      expect(isLikelyTradingRelevant(query)).toBe(true);
    }
  });
});

describe("pickRandomEligible", () => {
  it("returns null for an empty list", () => {
    expect(pickRandomEligible([], 10)).toBeNull();
  });

  it("only picks items meeting the minimum duration when any qualify", () => {
    const items = [{ duration: 3 }, { duration: 20 }, { duration: 25 }];
    for (let i = 0; i < 20; i++) {
      const pick = pickRandomEligible(items, 10);
      expect(pick!.duration).toBeGreaterThanOrEqual(10);
    }
  });

  it("falls back to the full pool when nothing meets the minimum duration, rather than returning null", () => {
    const items = [{ duration: 3 }, { duration: 5 }];
    const pick = pickRandomEligible(items, 10);
    expect(pick).not.toBeNull();
    expect(items).toContainEqual(pick);
  });

  it("varies its pick across calls -- not hardcoded to the first eligible item (the old Pexels behavior this replaces)", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ duration: 30, id: i }));
    vi.spyOn(Math, "random").mockRestore();
    const picks = new Set<number>();
    for (let i = 0; i < 50; i++) {
      picks.add(pickRandomEligible(items, 10)!.id);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

const PEXELS_VIDEO = {
  id: 111,
  duration: 30,
  url: "https://www.pexels.com/video/stock-market-candlestick-chart-111/",
  video_files: [{ quality: "hd", link: "https://pexels.example/clip-111.mp4", file_type: "video/mp4" }],
};
const PIXABAY_HIT = {
  id: 222,
  duration: 30,
  tags: "trading, stock market, chart",
  videos: { medium: { url: "https://pixabay.example/clip-222.mp4", width: 1280 }, large: { url: "", width: 0 }, small: { url: "", width: 0 } },
};

describe("isLikelyTradingRelevant", () => {
  it("passes text with a strong trading/markets term", () => {
    expect(isLikelyTradingRelevant("a trader typing on a laptop")).toBe(true);
    expect(isLikelyTradingRelevant("stock market chart close up")).toBe(true);
    expect(isLikelyTradingRelevant("candlestick chart forex trading")).toBe(true);
    expect(isLikelyTradingRelevant("day trader futures monitors")).toBe(true);
  });

  it("rejects generic office/laptop/desk footage with no trading term -- the real production bug (generic footage slipping through)", () => {
    expect(isLikelyTradingRelevant("business, office, desk, computer")).toBe(false);
    expect(isLikelyTradingRelevant("woman typing on a laptop in a cafe")).toBe(false);
    expect(isLikelyTradingRelevant("man working at a desk with money and data")).toBe(false);
  });

  it("rejects text naming something with no trading connection", () => {
    expect(isLikelyTradingRelevant("a golfer swinging a club")).toBe(false);
    expect(isLikelyTradingRelevant("family, vacation, beach, sunset")).toBe(false);
    expect(isLikelyTradingRelevant("people dancing at a festival")).toBe(false);
  });

  it("vetoes ambiguous 'market'/'stock' words used in non-trading senses", () => {
    expect(isLikelyTradingRelevant("busy farmers market vendors")).toBe(false);
    expect(isLikelyTradingRelevant("shopping in a supermarket")).toBe(false);
    expect(isLikelyTradingRelevant("livestock cattle on a farm")).toBe(false);
    expect(isLikelyTradingRelevant("vacation trader stock market on the beach")).toBe(false);
  });

  it("rejects food-market and street-vendor footage -- the exact real-world bug: bare 'market' was previously enough on its own to pass", () => {
    expect(isLikelyTradingRelevant("outdoor market vendors selling goods")).toBe(false);
    expect(isLikelyTradingRelevant("busy street market in asia")).toBe(false);
    expect(isLikelyTradingRelevant("night market food stalls")).toBe(false);
    expect(isLikelyTradingRelevant("colorful marketplace with merchants")).toBe(false);
    expect(isLikelyTradingRelevant("local bazaar with fruit and spices")).toBe(false);
    expect(isLikelyTradingRelevant("open air market crowd walking")).toBe(false);
    // Bare "market"/"markets" with NO other finance term is never enough,
    // even when there's no recognizable veto word either.
    expect(isLikelyTradingRelevant("a busy market at sunset")).toBe(false);
  });

  it("still passes genuine stock/financial-market footage now that bare 'market' is no longer a strong signal on its own", () => {
    expect(isLikelyTradingRelevant("stock market chart close up")).toBe(true);
    expect(isLikelyTradingRelevant("financial markets analysis on screen")).toBe(true);
    expect(isLikelyTradingRelevant("trader watching the market crash")).toBe(true);
    expect(isLikelyTradingRelevant("wall street trading floor")).toBe(true);
  });
});

describe("fetchStockClip -- filters out irrelevant B-roll", () => {
  const originalFetch = global.fetch;
  let cacheDir: string;

  afterEach(() => {
    global.fetch = originalFetch;
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it("drops a search result whose own description names something unrelated to trading (a real production incident: golf-course and generic lifestyle footage got shown in rendered videos)", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const golfPexelsVideo = { ...PEXELS_VIDEO, url: "https://www.pexels.com/video/a-golfer-swinging-a-club-111/" };
    const vacationPixabayHit = { ...PIXABAY_HIT, tags: "family, vacation, beach, sunset" };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("pexels.com")) return jsonResponse({ videos: [golfPexelsVideo] });
      if (url.includes("pixabay.com")) return jsonResponse({ hits: [vacationPixabayHit] });
      return downloadResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });

    // Both candidates were off-topic -- no clip at all (falls back to a
    // solid-color background upstream) is the correct, safe outcome, never
    // showing the golf/vacation footage just because something matched the query text.
    expect(result).toBeNull();
  });

  it("keeps a relevant result and still filters out an irrelevant one from the same search", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const relevantPexelsVideo = { ...PEXELS_VIDEO, id: 333, url: "https://www.pexels.com/video/a-trader-typing-on-a-laptop-333/" };
    const golfPixabayHit = { ...PIXABAY_HIT, tags: "golf, sport, leisure" };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("pexels.com")) return jsonResponse({ videos: [relevantPexelsVideo] });
      if (url.includes("pixabay.com")) return jsonResponse({ hits: [golfPixabayHit] });
      return downloadResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });

    expect(result).toContain("pexels-333.mp4");
  });
});

describe("fetchStockClip -- undescribed clips", () => {
  const originalFetch = global.fetch;
  let cacheDir: string;

  afterEach(() => {
    global.fetch = originalFetch;
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it("rejects a clip with no description at all instead of trusting it", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const undescribed = { id: 444, duration: 30, video_files: PEXELS_VIDEO.video_files };
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("pexels.com")) return jsonResponse({ videos: [undescribed] });
      return downloadResponse();
    }) as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: null });
    expect(result).toBeNull();
  });
});

describe("fetchStockClip -- searches Pexels and Pixabay together", () => {
  const originalFetch = global.fetch;
  let cacheDir: string;

  afterEach(() => {
    global.fetch = originalFetch;
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it("combines results from both providers into one selection pool", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("pexels.com")) return jsonResponse({ videos: [PEXELS_VIDEO] });
      if (url.includes("pixabay.com")) return jsonResponse({ hits: [PIXABAY_HIT] });
      return downloadResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });

    expect(result).not.toBeNull();
    const files = readdirSync(cacheDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^(pexels-111|pixabay-222)\.mp4$/);
  });

  it("works with only one provider configured", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("pixabay.com")) return jsonResponse({ hits: [PIXABAY_HIT] });
      return downloadResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: null, pixabayApiKey: "pix-key" });

    expect(result).toContain("pixabay-222.mp4");
    // Only the configured provider was ever searched.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("pexels.com"))).toBe(false);
  });

  it("returns null when neither provider is configured", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: null, pixabayApiKey: null });
    expect(result).toBeNull();
  });

  it("returns null gracefully (never throws) when one provider's request fails and the other has no results", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });
    expect(result).toBeNull();
  });

  it("reuses an already-cached clip instead of re-fetching search results", async () => {
    cacheDir = mkdtempSync(join(tmpdir(), "stock-footage-test-"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ videos: [PEXELS_VIDEO] }))
      .mockResolvedValueOnce(jsonResponse({ hits: [] }))
      .mockResolvedValueOnce(downloadResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });
    expect(first).toContain("pexels-111.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Re-searching (deterministically returning the same asset id, since
    // there's only one candidate) must still hit the cache and never
    // download again -- the download branch throwing proves this.
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes("pexels.com")) return jsonResponse({ videos: [PEXELS_VIDEO] });
      if (String(url).includes("pixabay.com")) return jsonResponse({ hits: [] });
      throw new Error("should not download again -- clip already cached");
    }) as unknown as typeof fetch;
    const second = await fetchStockClip("trader at desk", 10, cacheDir, { pexelsApiKey: "pex-key", pixabayApiKey: "pix-key" });
    expect(second).toBe(first);
  });
});
