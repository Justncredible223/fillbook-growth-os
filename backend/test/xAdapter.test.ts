import { describe, it, expect, vi } from "vitest";
import { XSignalAdapter, XApiError } from "../src/signals/adapters/xAdapter";
import { InMemoryXTokenStore } from "../src/signals/adapters/xTokenStore";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("XSignalAdapter", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("uses the stored access token when it isn't near expiry", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ data: [] }),
    );
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchOwnMentions("123", undefined, now);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0]!;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer valid-token");
  });

  it("refreshes the access token when it's near expiry and persists the new pair", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "stale-token",
      refreshToken: "old-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 7200 }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchOwnMentions("123", undefined, now);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshCall = fetchMock.mock.calls[0]!;
    expect(refreshCall[0]).toBe("https://api.x.com/2/oauth2/token");
    const mentionsCall = fetchMock.mock.calls[1]!;
    expect((mentionsCall[1].headers as Record<string, string>).Authorization).toBe("Bearer new-token");

    const saved = await store.load();
    expect(saved?.accessToken).toBe("new-token");
    expect(saved?.refreshToken).toBe("new-refresh");
  });

  it("falls back to the existing refresh token if the refresh response doesn't rotate it", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "stale-token",
      refreshToken: "stable-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", expires_in: 7200 }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    await adapter.fetchOwnMentions("123", undefined, now);

    const saved = await store.load();
    expect(saved?.refreshToken).toBe("stable-refresh");
  });

  it("throws XApiError with actionable guidance when no tokens are stored", async () => {
    const store = new InMemoryXTokenStore(null);
    const adapter = new XSignalAdapter("client-id", "client-secret", store, vi.fn());

    await expect(adapter.fetchOwnMentions("123", undefined, now)).rejects.toThrow(XApiError);
    await expect(adapter.fetchOwnMentions("123", undefined, now)).rejects.toThrow(/Generate a user Access Token/);
  });

  it("throws XApiError with the response body on a failed API call", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ errors: [{ detail: "Not authorized" }] }, false, 403),
    );
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    await expect(adapter.fetchOwnMentions("123", undefined, now)).rejects.toThrow(/HTTP 403/);
  });

  it("maps mention fields correctly, including missing optional fields", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "1",
            text: "hello @FillbookHQ",
            author_id: "42",
            created_at: "2026-09-01T10:00:00Z",
            public_metrics: { like_count: 3 },
          },
          { id: "2", text: "no extra fields" },
        ],
      }),
    );
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    const mentions = await adapter.fetchOwnMentions("123", undefined, now);

    expect(mentions).toEqual([
      {
        id: "1",
        text: "hello @FillbookHQ",
        authorId: "42",
        createdAt: new Date("2026-09-01T10:00:00Z"),
        publicMetrics: { like_count: 3 },
      },
      { id: "2", text: "no extra fields", authorId: null, createdAt: null, publicMetrics: null },
    ]);
  });

  it("resolves the own user id from /users/me", async () => {
    const store = new InMemoryXTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: "999" } }));
    const adapter = new XSignalAdapter("client-id", "client-secret", store, fetchMock);

    const id = await adapter.resolveOwnUserId(now);

    expect(id).toBe("999");
  });
});
