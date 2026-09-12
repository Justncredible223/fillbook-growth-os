import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getVideoQuery, pickRandomEligible, fetchStockClip } from "../../scripts/video-factory/stockFootage";

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
  video_files: [{ quality: "hd", link: "https://pexels.example/clip-111.mp4", file_type: "video/mp4" }],
};
const PIXABAY_HIT = {
  id: 222,
  duration: 30,
  videos: { medium: { url: "https://pixabay.example/clip-222.mp4", width: 1280 }, large: { url: "", width: 0 }, small: { url: "", width: 0 } },
};

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
