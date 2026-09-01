import { describe, it, expect, vi } from "vitest";
import { YouTubeAdapter } from "../src/signals/adapters/youtubeAdapter";
import { GoogleApiError } from "../src/signals/adapters/searchConsoleAdapter";
import { InMemoryGoogleTokenStore } from "../src/signals/adapters/googleTokenStore";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("YouTubeAdapter", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const validState = {
    accessToken: "valid-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  };

  it("uses the stored access token and never sends publishedAfter", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const adapter = new YouTubeAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchOwnVideos(now);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer valid-token");
    expect(url).toContain("forMine=true");
    // publishedAfter is deliberately never sent -- YouTube's search.list
    // rejects it combined with forMine=true (HTTP 400), reproduced
    // directly against the real API. See youtubeAdapter.ts.
    expect(url).not.toContain("publishedAfter");
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
      .mockResolvedValueOnce(jsonResponse({ items: [] }));
    const adapter = new YouTubeAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchOwnVideos(now);

    const saved = await store.load();
    expect(saved?.accessToken).toBe("new-token");
    expect(saved?.refreshToken).toBe("stable-refresh");
  });

  it("throws GoogleApiError with actionable guidance when no tokens are stored", async () => {
    const store = new InMemoryGoogleTokenStore(null);
    const adapter = new YouTubeAdapter("client-id", "client-secret", store, vi.fn());

    await expect(adapter.fetchOwnVideos(now)).rejects.toThrow(GoogleApiError);
  });

  it("maps video fields correctly", async () => {
    const store = new InMemoryGoogleTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: { videoId: "abc123" },
            snippet: { title: "Why 2 contracts is a bad rule", publishedAt: "2026-08-31T10:00:00Z" },
          },
        ],
      }),
    );
    const adapter = new YouTubeAdapter("client-id", "client-secret", store, fetchMock);

    const videos = await adapter.fetchOwnVideos(now);

    expect(videos).toEqual([
      { videoId: "abc123", title: "Why 2 contracts is a bad rule", publishedAt: new Date("2026-08-31T10:00:00Z") },
    ]);
  });
});
