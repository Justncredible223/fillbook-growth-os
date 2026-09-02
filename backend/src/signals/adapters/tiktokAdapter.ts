import type { SupabaseClient } from "@supabase/supabase-js";
import type { TikTokTokenState, TikTokTokenStore } from "./tiktokTokenStore.js";
import {
  BootstrappingTikTokTokenStore,
  SupabaseTikTokTokenStore,
  bootstrapTikTokTokenStateFromEnv,
} from "./tiktokTokenStore.js";

const TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";
const VIDEO_LIST_FIELDS = "id,create_time,title,view_count,like_count,comment_count,share_count";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export class TikTokApiError extends Error {}

export interface TikTokVideo {
  videoId: string;
  title: string;
  createdAt: Date;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  shareCount: number;
}

/**
 * TikTok's read-only Display API surface (video.list, user.info.basic
 * scopes only -- no video.publish, no video.upload). This is the same
 * organic-metrics-only shape as the X and YouTube adapters: it can see
 * what's already posted, it can never post, edit, delete, comment, like,
 * or follow. Structurally enforced twice over -- there is no method here
 * that calls a write endpoint, and even if there were,
 * ExternalWriteFirewall rejects tiktok.publish_video/comment/like_video/
 * follow_account unconditionally (see externalWriteFirewall.ts).
 *
 * TikTok Promote (the platform's own paid-boost feature) is separately,
 * permanently blocked at the account level for @fillbookhq -- see
 * docs/CLAUDE_HANDOFF.md in the fillbookhq project ("Prohibited Industry -
 * Financial Opportunity"). That's a TikTok policy decision on this
 * account's content category, unrelated to and unaffected by this
 * adapter -- wiring this up only ever adds read-only organic-performance
 * signals, never a path to Promote or any other paid/write feature.
 */
export class TikTokAdapter {
  constructor(
    private clientKey: string,
    private clientSecret: string,
    private tokenStore: TikTokTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new TikTokApiError(
        "No TikTok OAuth tokens stored. Authorize via the OAuth consent flow " +
          "(see docs/PROGRESS_LEDGER.md Phase 12) as the account that owns " +
          "@fillbookhq, requesting only the user.info.basic and video.list " +
          "scopes, then seed platform_oauth_credentials via " +
          "TIKTOK_ACCESS_TOKEN/TIKTOK_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<TikTokTokenState> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new TikTokApiError(`TikTok token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!json.access_token || !json.expires_in) {
      throw new TikTokApiError(
        `TikTok token refresh returned no access_token -- ${json.error ?? "unknown"}: ${json.error_description ?? "no description"}`,
      );
    }
    return {
      accessToken: json.access_token,
      // TikTok's refresh flow rotates the refresh token on every use --
      // unlike X/Google, there's no "keep the old one" fallback here.
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  /**
   * Own uploaded videos with public engagement metrics, newest first. No
   * write scope requested or used -- see the class doc comment.
   */
  async fetchOwnVideos(now: Date = new Date()): Promise<TikTokVideo[]> {
    const token = await this.getValidAccessToken(now);
    const res = await this.fetchImpl(`https://open.tiktokapis.com/v2/video/list/?fields=${VIDEO_LIST_FIELDS}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: 20 }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new TikTokApiError(`TikTok video.list request failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as {
      data?: {
        videos?: Array<{
          id: string;
          title?: string;
          create_time: number;
          view_count?: number;
          like_count?: number;
          comment_count?: number;
          share_count?: number;
        }>;
      };
      error?: { code: string; message: string };
    };
    if (json.error && json.error.code !== "ok") {
      throw new TikTokApiError(`TikTok video.list API error: ${json.error.code} -- ${json.error.message}`);
    }

    return (json.data?.videos ?? []).map((video) => ({
      videoId: video.id,
      title: video.title ?? "",
      // TikTok returns create_time as Unix seconds, not milliseconds/ISO.
      createdAt: new Date(video.create_time * 1000),
      viewCount: video.view_count ?? 0,
      likeCount: video.like_count ?? 0,
      commentCount: video.comment_count ?? 0,
      shareCount: video.share_count ?? 0,
    }));
  }
}

export function createTikTokAdapter(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): TikTokAdapter {
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new TikTokApiError("TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingTikTokTokenStore(
    new SupabaseTikTokTokenStore(supabase),
    bootstrapTikTokTokenStateFromEnv(env),
  );
  return new TikTokAdapter(clientKey, clientSecret, tokenStore);
}
