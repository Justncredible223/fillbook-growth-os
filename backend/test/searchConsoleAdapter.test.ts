import { describe, it, expect, vi } from "vitest";
import { SearchConsoleAdapter, GoogleApiError } from "../src/signals/adapters/searchConsoleAdapter";
import { InMemoryGoogleTokenStore } from "../src/signals/adapters/googleTokenStore";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("SearchConsoleAdapter", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const validState = {
    accessToken: "valid-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  };

  it("uses the stored access token when it isn't near expiry", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [] }));
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchTopQueries("https://fillbookhq.com/", "2026-08-01", "2026-08-07", 25, now);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0]!;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer valid-token");
  });

  it("refreshes an expiring token without rotating the refresh token", async () => {
    const store = new InMemoryGoogleTokenStore({
      accessToken: "stale-token",
      refreshToken: "stable-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ rows: [] }));
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchTopQueries("https://fillbookhq.com/", "2026-08-01", "2026-08-07", 25, now);

    const saved = await store.load();
    expect(saved?.accessToken).toBe("new-token");
    expect(saved?.refreshToken).toBe("stable-refresh");
  });

  it("throws GoogleApiError with actionable guidance when no tokens are stored", async () => {
    const store = new InMemoryGoogleTokenStore(null);
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, vi.fn());

    await expect(
      adapter.fetchTopQueries("https://fillbookhq.com/", "2026-08-01", "2026-08-07", 25, now),
    ).rejects.toThrow(/Authorize via the OAuth consent flow/);
  });

  it("maps query rows correctly", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        rows: [{ keys: ["futures position sizing"], clicks: 12, impressions: 300, ctr: 0.04, position: 8.5 }],
      }),
    );
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, fetchMock);

    const rows = await adapter.fetchTopQueries("https://fillbookhq.com/", "2026-08-01", "2026-08-07", 25, now);

    expect(rows).toEqual([
      { query: "futures position sizing", clicks: 12, impressions: 300, ctr: 0.04, position: 8.5 },
    ]);
  });

  it("resolves the site URL from the accessible sites list", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ siteEntry: [{ siteUrl: "https://fillbookhq.com/", permissionLevel: "siteOwner" }] }),
    );
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, fetchMock);

    const siteUrl = await adapter.resolveSiteUrl(now);

    expect(siteUrl).toBe("https://fillbookhq.com/");
  });

  it("throws GoogleApiError when no accessible sites are returned", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ siteEntry: [] }));
    const adapter = new SearchConsoleAdapter("client-id", "client-secret", store, fetchMock);

    await expect(adapter.resolveSiteUrl(now)).rejects.toThrow(GoogleApiError);
  });
});
