import { describe, it, expect, vi } from "vitest";
import { TikTokAdapter, TikTokApiError } from "../src/signals/adapters/tiktokAdapter";
import { InMemoryTikTokTokenStore } from "../src/signals/adapters/tiktokTokenStore";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("TikTokAdapter", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const validState = {
    accessToken: "valid-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
  };

  it("uses the stored access token and requests no write scope endpoint", async () => {
    const store = new InMemoryTikTokTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { videos: [] } }));
    const adapter = new TikTokAdapter("client-key", "client-secret", store, fetchMock);

    await adapter.fetchOwnVideos(now);

    const [url, options] = fetchMock.mock.calls[0]!;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer valid-token");
    expect(url).toContain("/v2/video/list/");
  });

  it("refreshes an expiring token and rotates the refresh token", async () => {
    const store = new InMemoryTikTokTokenStore({
      accessToken: "stale-token",
      refreshToken: "stable-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "new-token", refresh_token: "rotated-refresh", expires_in: 86400 }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { videos: [] } }));
    const adapter = new TikTokAdapter("client-key", "client-secret", store, fetchMock);

    await adapter.fetchOwnVideos(now);

    const saved = await store.load();
    expect(saved?.accessToken).toBe("new-token");
    // Unlike X/Google, TikTok rotates the refresh token on every use.
    expect(saved?.refreshToken).toBe("rotated-refresh");
  });

  it("throws TikTokApiError with actionable guidance when no tokens are stored", async () => {
    const store = new InMemoryTikTokTokenStore(null);
    const adapter = new TikTokAdapter("client-key", "client-secret", store, vi.fn());

    await expect(adapter.fetchOwnVideos(now)).rejects.toThrow(TikTokApiError);
  });

  it("maps video fields correctly, converting create_time from Unix seconds", async () => {
    const store = new InMemoryTikTokTokenStore(validState);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          videos: [
            {
              id: "abc123",
              title: "Why 2 contracts is a bad rule",
              create_time: 1_756_634_400,
              view_count: 1000,
              like_count: 50,
              comment_count: 5,
              share_count: 2,
            },
          ],
        },
      }),
    );
    const adapter = new TikTokAdapter("client-key", "client-secret", store, fetchMock);

    const videos = await adapter.fetchOwnVideos(now);

    expect(videos).toEqual([
      {
        videoId: "abc123",
        title: "Why 2 contracts is a bad rule",
        createdAt: new Date(1_756_634_400 * 1000),
        viewCount: 1000,
        likeCount: 50,
        commentCount: 5,
        shareCount: 2,
      },
    ]);
  });

  it("throws TikTokApiError when the API returns a non-ok error code", async () => {
    const store = new InMemoryTikTokTokenStore(validState);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "access_token_invalid", message: "token expired" } }));
    const adapter = new TikTokAdapter("client-key", "client-secret", store, fetchMock);

    await expect(adapter.fetchOwnVideos(now)).rejects.toThrow(TikTokApiError);
  });
});
