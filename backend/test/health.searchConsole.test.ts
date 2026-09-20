import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveSiteUrl = vi.fn();
const fetchTopQueries = vi.fn();
const createSearchConsoleAdapter = vi.fn(() => ({ resolveSiteUrl, fetchTopQueries }));
vi.mock("../src/signals/adapters/searchConsoleAdapter.js", () => ({ createSearchConsoleAdapter }));

const { verifySearchConsoleLive } = await import("../api/health");

/**
 * Growth loop item 8 (2026-09-18): verifies the real bounded live-check
 * function reports exactly what the task asked for -- property, dates,
 * row count, freshness, and any access failure -- without ever needing a
 * real Google API call in this test (the adapter itself is fully mocked;
 * SearchConsoleAdapter's own real-vs-mocked HTTP behavior is out of scope
 * for this file).
 */
describe("verifySearchConsoleLive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports property, dates, row count, and freshness on success", async () => {
    resolveSiteUrl.mockResolvedValue("https://www.fillbookhq.com/");
    fetchTopQueries.mockResolvedValue([
      { query: "trading journal", clicks: 3, impressions: 40, ctr: 0.075, position: 8.2 },
      { query: "prop firm journal", clicks: 1, impressions: 12, ctr: 0.08, position: 11.4 },
    ]);

    const result = await verifySearchConsoleLive({} as any);

    expect(result.status).toBe("HEALTHY");
    expect(result.property).toBe("https://www.fillbookhq.com/");
    expect(result.rowCount).toBe(2);
    expect(typeof result.startDate).toBe("string");
    expect(typeof result.endDate).toBe("string");
    expect(result.freshness).toContain(String(result.endDate));
  });

  it("queries exactly a 7-day bounded window, not an unbounded/full-history range", async () => {
    resolveSiteUrl.mockResolvedValue("https://www.fillbookhq.com/");
    fetchTopQueries.mockResolvedValue([]);

    await verifySearchConsoleLive({} as any);

    const [, startDate, endDate] = fetchTopQueries.mock.calls.at(-1)!;
    const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it("uses a small, fixed row limit -- this is a verification probe, not a real ingestion pull", async () => {
    resolveSiteUrl.mockResolvedValue("https://www.fillbookhq.com/");
    fetchTopQueries.mockResolvedValue([]);

    await verifySearchConsoleLive({} as any);

    const rowLimit = fetchTopQueries.mock.calls.at(-1)![3];
    expect(rowLimit).toBeLessThanOrEqual(10);
  });

  it("reports a real DOWN status with the actual error message on failure, never a fabricated success", async () => {
    resolveSiteUrl.mockRejectedValue(new Error("Google Search Console API request failed: HTTP 403 -- insufficient permission"));

    const result = await verifySearchConsoleLive({} as any);

    expect(result.status).toBe("DOWN");
    expect(result.error).toContain("403");
    expect(result.rowCount).toBeUndefined();
  });

  it("reports a clear DOWN status when no OAuth tokens are configured at all", async () => {
    resolveSiteUrl.mockRejectedValue(new Error("No Google OAuth tokens stored."));

    const result = await verifySearchConsoleLive({} as any);

    expect(result.status).toBe("DOWN");
    expect(result.error).toContain("No Google OAuth tokens");
  });

  it("never touches credential rotation or permissions -- only resolveSiteUrl/fetchTopQueries are called, nothing else on the adapter", async () => {
    resolveSiteUrl.mockResolvedValue("https://www.fillbookhq.com/");
    fetchTopQueries.mockResolvedValue([]);

    await verifySearchConsoleLive({} as any);

    expect(createSearchConsoleAdapter).toHaveBeenCalledTimes(1);
    expect(resolveSiteUrl).toHaveBeenCalledTimes(1);
    expect(fetchTopQueries).toHaveBeenCalledTimes(1);
  });
});
