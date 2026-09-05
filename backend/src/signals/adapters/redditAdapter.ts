import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedditTokenState, RedditTokenStore } from "./redditTokenStore.js";
import { BootstrappingRedditTokenStore, SupabaseRedditTokenStore, bootstrapRedditTokenStateFromEnv } from "./redditTokenStore.js";

const TOKEN_ENDPOINT = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export class RedditApiError extends Error {}

/** One inbox item: a comment reply, a username mention, or a private message -- whatever `GET /message/inbox` returns. Read-only; nothing here can reply, vote, or send a message. */
export interface RedditInboxItem {
  /** Reddit's "fullname" (e.g. "t1_abc123" for a comment, "t4_xyz" for a PM) -- the stable dedup key, unique across all of Reddit. */
  fullname: string;
  /** The bare id portion of fullname (e.g. "abc123") -- what a permalink needs. */
  id: string;
  kind: "comment_reply" | "username_mention" | "private_message" | "other";
  authorHandle: string | null;
  body: string;
  subreddit: string | null;
  createdAt: Date | null;
  /** fullname of the thing this is a reply to (a comment or the original post), if any -- thread/parent context. */
  parentFullname: string | null;
  /** The submission this comment thread lives under (t3_xxx), if determinable. */
  linkFullname: string | null;
  permalink: string | null;
  wasComment: boolean;
  isUnread: boolean;
}

/** One public post found by a subreddit search -- someone else's post, not our own account's activity. */
export interface RedditSearchResult {
  fullname: string;
  id: string;
  title: string;
  selftext: string;
  authorHandle: string | null;
  subreddit: string;
  createdAt: Date | null;
  score: number;
  numComments: number;
  permalink: string;
  isSelf: boolean;
}

interface RawListingChild<T> {
  kind: string;
  data: T;
}
interface RawListing<T> {
  data: { children: Array<RawListingChild<T>> };
}

interface RawInboxData {
  id: string;
  name: string;
  author?: string;
  body?: string;
  subreddit?: string;
  created_utc?: number;
  parent_id?: string;
  link_id?: string;
  context?: string;
  was_comment?: boolean;
  new?: boolean;
  type?: string; // "comment_reply" | "username_mention" | ... (present on /message/inbox items)
}

interface RawSubmissionData {
  id: string;
  name: string;
  title: string;
  selftext?: string;
  author?: string;
  subreddit?: string;
  created_utc?: number;
  score?: number;
  num_comments?: number;
  permalink: string;
  is_self?: boolean;
}

/**
 * Talks to Reddit's OAuth API, read-only. Mirrors the shape of
 * XSignalAdapter/TikTokAdapter (bootstrap-then-self-persist token pair,
 * plain fetch, no method that can write anything). Every request needs a
 * descriptive User-Agent per Reddit's API rules
 * (https://github.com/reddit-archive/reddit/wiki/API) -- requests with a
 * generic/default UA are more likely to be throttled or blocked outright.
 *
 * fetchInboxActivity() reads OUR OWN inbox (comment replies, username
 * mentions, private messages) -- the Reddit inbound-monitoring surface.
 * searchSubreddit() reads OTHER people's public posts in a configured
 * subreddit -- the Reddit prospecting surface. Both use the same
 * user-context OAuth token; Reddit's API (unlike X's tiered Owned-Reads
 * pricing) has one free-tier rate limit for authenticated requests (100
 * queries/minute per OAuth client, per Reddit's Data API terms as of this
 * writing -- see docs/REDDIT_INTEGRATION.md for the full policy notes and
 * why this needs re-verification against reddit.com's own docs before
 * relying on it long-term).
 */
export class RedditSignalAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private userAgent: string,
    private tokenStore: RedditTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new RedditApiError(
        "No Reddit OAuth tokens stored. Create a Reddit 'script' app (see docs/REDDIT_INTEGRATION.md), " +
          "complete its OAuth consent flow once as the @fillbookhq Reddit account requesting the " +
          "'identity read history' scopes, then seed platform_oauth_credentials via " +
          "REDDIT_ACCESS_TOKEN/REDDIT_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<RedditTokenState> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        "User-Agent": this.userAgent,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new RedditApiError(`Reddit token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: json.access_token,
      // Reddit's refresh flow does not rotate the refresh token itself for
      // the standard authorization-code grant -- fall back to the one we
      // already had if a new one isn't returned.
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  private async authedGet(path: string, params: Record<string, string>, now: Date = new Date()): Promise<unknown> {
    const token = await this.getValidAccessToken(now);
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": this.userAgent },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new RedditApiError(`Reddit API GET ${path} failed: HTTP ${res.status} -- ${body}`);
    }
    return res.json();
  }

  /** Resolves the authenticated account's own username -- used for logging/health only; Reddit's inbox endpoints are already scoped to "me" implicitly. */
  async resolveOwnUsername(now: Date = new Date()): Promise<string> {
    const json = (await this.authedGet("/api/v1/me", {}, now)) as { name?: string };
    if (!json.name) throw new RedditApiError("Reddit API /api/v1/me returned no username");
    return json.name;
  }

  private mapInboxType(type: string | undefined, wasComment: boolean | undefined): RedditInboxItem["kind"] {
    if (type === "comment_reply") return "comment_reply";
    if (type === "username_mention") return "username_mention";
    if (type === "unknown" || type === undefined) return wasComment ? "comment_reply" : "other";
    return "private_message";
  }

  /**
   * `GET /message/inbox` -- the one endpoint that surfaces everything
   * Reddit's API can tell us about inbound activity: comment replies,
   * username mentions, and private messages, most-recent first. There is
   * no separate "replies to a reply we made in an already-tracked
   * conversation" endpoint -- those simply show up here as ordinary
   * comment_reply items with a different parent_id, which the ingestion
   * layer resolves against already-tracked rows via conversationId
   * (link_id).
   *
   * Pagination: Reddit listings are anchored slices, NOT X-style
   * since_id windows. `after=<fullname>` returns the page that follows
   * that item in listing order (i.e. OLDER items); `before=<fullname>`
   * returns the slice preceding it, and returns NOTHING at all once the
   * anchor item has left the listing (deleted comment, removed by a mod,
   * aged past Reddit's ~1000-item listing cap). That makes a stored
   * fullname unsafe as a forward cursor. This method therefore only
   * exposes `after` (walk older) and always starts from the top of the
   * inbox when `after` is omitted; the "only process what's new"
   * decision is made by redditIngestion.ts's timestamp high-water mark,
   * which cannot be invalidated by an item disappearing.
   */
  async fetchInboxActivity(after?: string, limit = 25, now: Date = new Date()): Promise<RedditInboxItem[]> {
    const params: Record<string, string> = { limit: String(Math.min(Math.max(limit, 1), 100)) };
    if (after) params.after = after;

    const json = (await this.authedGet("/message/inbox", params, now)) as RawListing<RawInboxData>;
    return (json.data?.children ?? []).map((child) => {
      const d = child.data;
      return {
        fullname: d.name,
        id: d.id,
        kind: this.mapInboxType(d.type, d.was_comment),
        authorHandle: d.author ?? null,
        body: d.body ?? "",
        subreddit: d.subreddit ?? null,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
        parentFullname: d.parent_id ?? null,
        linkFullname: d.link_id ?? null,
        permalink: d.context ? `https://www.reddit.com${d.context}` : null,
        wasComment: Boolean(d.was_comment),
        isUnread: d.new ?? false,
      };
    });
  }

  /**
   * `GET /r/{subreddit}/search` restricted to that subreddit
   * (restrict_sr=1) -- public posts, not our own activity. `sort=new` and
   * a bounded `limit` keep this a small, cheap, discovery-oriented read
   * rather than an unbounded crawl; a caller wanting genuinely worthwhile
   * candidates should keep `limit` small (this project's Reddit
   * prospecting caller uses single digits per subreddit -- see
   * redditProspectingSearch.ts).
   */
  async searchSubreddit(subreddit: string, query: string, limit = 10, now: Date = new Date()): Promise<RedditSearchResult[]> {
    const params: Record<string, string> = {
      q: query,
      restrict_sr: "1",
      sort: "new",
      t: "week",
      limit: String(Math.min(Math.max(limit, 1), 25)),
    };
    const json = (await this.authedGet(`/r/${subreddit}/search`, params, now)) as RawListing<RawSubmissionData>;
    return (json.data?.children ?? []).map((child) => {
      const d = child.data;
      return {
        fullname: d.name,
        id: d.id,
        title: d.title,
        selftext: d.selftext ?? "",
        authorHandle: d.author ?? null,
        subreddit: d.subreddit ?? subreddit,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000) : null,
        score: d.score ?? 0,
        numComments: d.num_comments ?? 0,
        permalink: `https://www.reddit.com${d.permalink}`,
        isSelf: d.is_self ?? true,
      };
    });
  }
}

/**
 * Wires a real, ready-to-use adapter from env vars + the Supabase service
 * client. Throws early and clearly if required env vars are missing,
 * matching createXSignalAdapter's contract.
 */
export function createRedditSignalAdapter(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): RedditSignalAdapter {
  const clientId = env.REDDIT_CLIENT_ID;
  const clientSecret = env.REDDIT_CLIENT_SECRET;
  const userAgent = env.REDDIT_USER_AGENT;
  if (!clientId || !clientSecret) {
    throw new RedditApiError("REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET are not set in the environment.");
  }
  if (!userAgent) {
    throw new RedditApiError(
      "REDDIT_USER_AGENT is not set -- Reddit requires a descriptive User-Agent on every request " +
        '(e.g. "web:fillbook-growth-os:v1.0 (by /u/<your-reddit-username>)"). Requests with a generic ' +
        "UA are throttled or blocked. See docs/REDDIT_INTEGRATION.md.",
    );
  }
  const tokenStore = new BootstrappingRedditTokenStore(new SupabaseRedditTokenStore(supabase), bootstrapRedditTokenStateFromEnv(env));
  return new RedditSignalAdapter(clientId, clientSecret, userAgent, tokenStore);
}
