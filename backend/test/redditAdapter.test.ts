import { describe, it, expect, vi } from "vitest";
import { RedditSignalAdapter, RedditApiError, createRedditSignalAdapter } from "../src/signals/adapters/redditAdapter";
import { InMemoryRedditTokenStore } from "../src/signals/adapters/redditTokenStore";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const UA = "web:fillbook-growth-os:v1.0 (by /u/test)";

describe("RedditSignalAdapter", () => {
  const now = new Date("2026-09-01T12:00:00Z");

  it("uses the stored access token when it isn't near expiry", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { children: [] } }));
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    await adapter.fetchInboxActivity(undefined, 25, now);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0]!;
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer valid-token");
    expect((options.headers as Record<string, string>)["User-Agent"]).toBe(UA);
  });

  it("refreshes the access token when near expiry, sends the User-Agent on the refresh call too, and persists the new pair", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "stale-token",
      refreshToken: "old-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: { children: [] } }));
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    await adapter.fetchInboxActivity(undefined, 25, now);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const refreshCall = fetchMock.mock.calls[0]!;
    expect(refreshCall[0]).toBe("https://www.reddit.com/api/v1/access_token");
    expect((refreshCall[1].headers as Record<string, string>)["User-Agent"]).toBe(UA);

    const saved = await store.load();
    expect(saved?.accessToken).toBe("new-token");
    expect(saved?.refreshToken).toBe("new-refresh");
  });

  it("falls back to the existing refresh token if the refresh response doesn't rotate it", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "stale-token",
      refreshToken: "stable-refresh",
      expiresAt: new Date(now.getTime() + 1000),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: { children: [] } }));
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    await adapter.fetchInboxActivity(undefined, 25, now);

    expect((await store.load())?.refreshToken).toBe("stable-refresh");
  });

  it("throws RedditApiError with actionable guidance when no tokens are stored", async () => {
    const store = new InMemoryRedditTokenStore(null);
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, vi.fn());

    await expect(adapter.fetchInboxActivity(undefined, 25, now)).rejects.toThrow(RedditApiError);
    await expect(adapter.fetchInboxActivity(undefined, 25, now)).rejects.toThrow(/Create a Reddit 'script' app/);
  });

  it("throws RedditApiError with the response body on a failed API call", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Forbidden" }, false, 403));
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    await expect(adapter.fetchInboxActivity(undefined, 25, now)).rejects.toThrow(/HTTP 403/);
  });

  it("maps inbox items -- comment_reply, username_mention, and an unrecognized type", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          children: [
            {
              kind: "t1",
              data: {
                id: "1",
                name: "t1_1",
                author: "someTrader",
                body: "how do you track drawdown?",
                subreddit: "FuturesTrading",
                created_utc: 1756728000,
                parent_id: "t1_parent",
                link_id: "t3_thread1",
                context: "/r/FuturesTrading/comments/thread1/x/parent/",
                was_comment: true,
                new: true,
                type: "comment_reply",
              },
            },
            {
              kind: "t1",
              data: { id: "2", name: "t1_2", body: "no extra fields", type: "username_mention" },
            },
          ],
        },
      }),
    );
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    const items = await adapter.fetchInboxActivity(undefined, 25, now);

    expect(items[0]).toEqual({
      fullname: "t1_1",
      id: "1",
      kind: "comment_reply",
      authorHandle: "someTrader",
      body: "how do you track drawdown?",
      subreddit: "FuturesTrading",
      createdAt: new Date(1756728000 * 1000),
      parentFullname: "t1_parent",
      linkFullname: "t3_thread1",
      permalink: "https://www.reddit.com/r/FuturesTrading/comments/thread1/x/parent/",
      wasComment: true,
      isUnread: true,
    });
    expect(items[1]).toEqual({
      fullname: "t1_2",
      id: "2",
      kind: "username_mention",
      authorHandle: null,
      body: "no extra fields",
      subreddit: null,
      createdAt: null,
      parentFullname: null,
      linkFullname: null,
      permalink: null,
      wasComment: false,
      isUnread: false,
    });
  });

  it("resolves the own username from /api/v1/me", async () => {
    const store = new InMemoryRedditTokenStore({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ name: "fillbookhq" }));
    const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

    expect(await adapter.resolveOwnUsername(now)).toBe("fillbookhq");
  });

  describe("searchSubreddit", () => {
    it("restricts to the subreddit, sorts by new, and maps submission fields", async () => {
      const store = new InMemoryRedditTokenStore({
        accessToken: "valid-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      });
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            children: [
              {
                kind: "t3",
                data: {
                  id: "abc",
                  name: "t3_abc",
                  title: "How do prop firm consistency rules even work",
                  selftext: "asking for a friend",
                  author: "someTrader",
                  subreddit: "FuturesTrading",
                  created_utc: 1756728000,
                  score: 12,
                  num_comments: 4,
                  permalink: "/r/FuturesTrading/comments/abc/x/",
                  is_self: true,
                },
              },
            ],
          },
        }),
      );
      const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

      const results = await adapter.searchSubreddit("FuturesTrading", "consistency rule", 8, now);

      expect(results).toEqual([
        {
          fullname: "t3_abc",
          id: "abc",
          title: "How do prop firm consistency rules even work",
          selftext: "asking for a friend",
          authorHandle: "someTrader",
          subreddit: "FuturesTrading",
          createdAt: new Date(1756728000 * 1000),
          score: 12,
          numComments: 4,
          permalink: "https://www.reddit.com/r/FuturesTrading/comments/abc/x/",
          isSelf: true,
        },
      ]);

      const [url] = fetchMock.mock.calls[0]!;
      const requested = new URL(url as string);
      expect(requested.pathname).toBe("/r/FuturesTrading/search");
      expect(requested.searchParams.get("restrict_sr")).toBe("1");
      expect(requested.searchParams.get("sort")).toBe("new");
    });

    it("clamps limit into a 1-25 range", async () => {
      const store = new InMemoryRedditTokenStore({
        accessToken: "valid-token",
        refreshToken: "refresh-token",
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      });
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { children: [] } }));
      const adapter = new RedditSignalAdapter("client-id", "client-secret", UA, store, fetchMock);

      await adapter.searchSubreddit("FuturesTrading", "q", 500, now);
      const requested = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(requested.searchParams.get("limit")).toBe("25");
    });
  });
});

describe("createRedditSignalAdapter -- missing configuration", () => {
  const fakeClient = {} as any;

  it("throws a useful error when REDDIT_CLIENT_ID/SECRET are missing", () => {
    expect(() => createRedditSignalAdapter(fakeClient, {})).toThrow(/REDDIT_CLIENT_ID\/REDDIT_CLIENT_SECRET/);
  });

  it("throws a useful error when REDDIT_USER_AGENT is missing, even with client id/secret present", () => {
    expect(() =>
      createRedditSignalAdapter(fakeClient, { REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv),
    ).toThrow(/REDDIT_USER_AGENT/);
  });

  it("succeeds when all required env vars are present", () => {
    expect(() =>
      createRedditSignalAdapter(fakeClient, {
        REDDIT_CLIENT_ID: "id",
        REDDIT_CLIENT_SECRET: "secret",
        REDDIT_USER_AGENT: "web:test:v1 (by /u/test)",
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});
