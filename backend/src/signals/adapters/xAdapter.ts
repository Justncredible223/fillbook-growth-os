import type { SupabaseClient } from "@supabase/supabase-js";
import type { XTokenState, XTokenStore } from "./xTokenStore.js";
import { BootstrappingXTokenStore, SupabaseXTokenStore, bootstrapXTokenStateFromEnv } from "./xTokenStore.js";

const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const API_BASE = "https://api.x.com/2";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export type ReferencedTweetType = "replied_to" | "quoted" | "retweeted";

export interface XMention {
  id: string;
  text: string;
  authorId: string | null;
  authorHandle: string | null;
  createdAt: Date | null;
  publicMetrics: Record<string, number> | null;
  /**
   * The user id this tweet is a reply TO, if it's a reply -- X's own field
   * for this, not derived. When it equals @FillbookHQ's own user id, this
   * is a direct reply to something we posted (as opposed to a standalone
   * mention). Previously not requested at all -- the adapter threw this
   * away before it ever reached ingestion, making "is this a reply to us"
   * undeterminable no matter what downstream code did with it.
   */
  inReplyToUserId: string | null;
  /** Groups every tweet in one reply chain -- lets ingestion detect "this is a second message in a conversation we already have a row for." */
  conversationId: string | null;
  /** "replied_to" | "quoted" | "retweeted" pairs, so a quote-post can be told apart from a plain reply. */
  referencedTweets: Array<{ type: ReferencedTweetType; id: string }>;
}

export class XApiError extends Error {}

/**
 * Talks to X's API for @FillbookHQ's own data only (Owned Reads pricing:
 * $0.001/resource for GET /2/users/{id}/mentions when {id} is the
 * authenticated user). Read-only by construction -- no method here can
 * post, reply, or otherwise write to X. See docs/PROGRESS_LEDGER.md
 * Phase 4/9 and the OAuth 2.0 app's scopes (tweet.read, users.read only,
 * no tweet.write).
 */
export class XSignalAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private tokenStore: XTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new XApiError(
        "No X OAuth tokens stored. Generate a user Access Token/Refresh Token " +
          "for @FillbookHQ from the X Developer Console (App > Keys & Tokens > " +
          "OAuth 2.0 Keys > Access Token > Generate), then seed " +
          "platform_oauth_credentials via X_ACCESS_TOKEN/X_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<XTokenState> {
    const basicAuth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.clientId,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new XApiError(`X token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: json.access_token,
      // X's refresh flow may or may not rotate the refresh token itself --
      // fall back to the one we already had if a new one isn't returned.
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  private async authedGet(path: string, params: Record<string, string>, now: Date = new Date()): Promise<unknown> {
    const token = await this.getValidAccessToken(now);
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new XApiError(`X API GET ${path} failed: HTTP ${res.status} -- ${body}`);
    }
    return res.json();
  }

  /** Resolves @FillbookHQ's numeric user id, required by the mentions endpoint. */
  async resolveOwnUserId(now: Date = new Date()): Promise<string> {
    const json = (await this.authedGet("/users/me", {}, now)) as { data?: { id: string } };
    if (!json.data?.id) throw new XApiError("X API /users/me returned no user id");
    return json.data.id;
  }

  /**
   * Owned Reads pricing ($0.001/resource) since {id} is the authenticated
   * user. Requests conversation_id/referenced_tweets/in_reply_to_user_id
   * (previously omitted entirely -- see the class doc comment) plus a
   * user expansion so a mention arrives with a real @handle instead of
   * only a numeric author id nothing downstream could act on.
   */
  async fetchOwnMentions(userId: string, sinceId?: string, now: Date = new Date()): Promise<XMention[]> {
    const params: Record<string, string> = {
      max_results: "50",
      "tweet.fields": "created_at,public_metrics,author_id,conversation_id,referenced_tweets,in_reply_to_user_id",
      expansions: "author_id",
      "user.fields": "username",
    };
    if (sinceId) params.since_id = sinceId;

    const json = (await this.authedGet(`/users/${userId}/mentions`, params, now)) as {
      data?: Array<{
        id: string;
        text: string;
        author_id?: string;
        created_at?: string;
        public_metrics?: Record<string, number>;
        conversation_id?: string;
        in_reply_to_user_id?: string;
        referenced_tweets?: Array<{ type: string; id: string }>;
      }>;
      includes?: { users?: Array<{ id: string; username: string }> };
    };

    const handleByAuthorId = new Map((json.includes?.users ?? []).map((u) => [u.id, u.username]));

    return (json.data ?? []).map((post) => ({
      id: post.id,
      text: post.text,
      authorId: post.author_id ?? null,
      authorHandle: post.author_id ? (handleByAuthorId.get(post.author_id) ?? null) : null,
      createdAt: post.created_at ? new Date(post.created_at) : null,
      publicMetrics: post.public_metrics ?? null,
      inReplyToUserId: post.in_reply_to_user_id ?? null,
      conversationId: post.conversation_id ?? null,
      referencedTweets: (post.referenced_tweets ?? [])
        .filter((r): r is { type: ReferencedTweetType; id: string } =>
          r.type === "replied_to" || r.type === "quoted" || r.type === "retweeted",
        )
        .map((r) => ({ type: r.type, id: r.id })),
    }));
  }
}

/**
 * Wires a real, ready-to-use adapter from env vars + the Supabase service
 * client. Throws early and clearly if the required env vars are missing,
 * rather than failing confusingly on the first API call.
 */
export function createXSignalAdapter(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): XSignalAdapter {
  const clientId = env.X_OAUTH_CLIENT_ID;
  const clientSecret = env.X_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new XApiError("X_OAUTH_CLIENT_ID/X_OAUTH_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingXTokenStore(new SupabaseXTokenStore(supabase), bootstrapXTokenStateFromEnv(env));
  return new XSignalAdapter(clientId, clientSecret, tokenStore);
}
