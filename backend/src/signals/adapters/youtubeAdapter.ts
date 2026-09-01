import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleTokenState, GoogleTokenStore } from "./googleTokenStore.js";
import {
  BootstrappingGoogleTokenStore,
  SupabaseGoogleTokenStore,
  bootstrapGoogleTokenStateFromEnv,
} from "./googleTokenStore.js";
import { GoogleApiError } from "./searchConsoleAdapter.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export interface YouTubeVideo {
  videoId: string;
  title: string;
  publishedAt: Date;
}

/**
 * Same client/token pair as SearchConsoleAdapter (see googleTokenStore.ts)
 * -- both were authorized together under one consent grant. Read-only:
 * search.list/videos.list only, nothing that can upload, edit, or delete.
 */
export class YouTubeAdapter {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private tokenStore: GoogleTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new GoogleApiError(
        "No Google OAuth tokens stored. Authorize via the OAuth consent flow " +
          "(see docs/PROGRESS_LEDGER.md Phase 4) as the account that owns the " +
          "YouTube channel, then seed platform_oauth_credentials via " +
          "GOOGLE_ACCESS_TOKEN/GOOGLE_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<GoogleTokenState> {
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GoogleApiError(`Google token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: json.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  private async authedGet(url: string, now: Date = new Date()): Promise<unknown> {
    const token = await this.getValidAccessToken(now);
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      throw new GoogleApiError(`YouTube API request failed: HTTP ${res.status} -- ${body}`);
    }
    return res.json();
  }

  /**
   * Videos uploaded to the authenticated user's own channel, newest
   * first. Deliberately never sends `publishedAfter` -- YouTube's
   * search.list rejects that combined with `forMine=true` with a bare
   * HTTP 400 "Request contains an invalid argument" (reproduced directly
   * against the real API 2026-09-01; removing publishedAfter alone fixed
   * it). Filtering by cursor is the caller's job now (see
   * ingestYouTubeVideos) -- fine at this channel's current scale
   * (maxResults=25 covers everything uploaded so far).
   */
  async fetchOwnVideos(now: Date = new Date()): Promise<YouTubeVideo[]> {
    const params = new URLSearchParams({
      part: "snippet",
      forMine: "true",
      type: "video",
      order: "date",
      maxResults: "25",
    });

    const json = (await this.authedGet(
      `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
      now,
    )) as {
      items?: Array<{ id: { videoId: string }; snippet: { title: string; publishedAt: string } }>;
    };

    return (json.items ?? []).map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      publishedAt: new Date(item.snippet.publishedAt),
    }));
  }
}

export function createYouTubeAdapter(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): YouTubeAdapter {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleApiError("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingGoogleTokenStore(
    new SupabaseGoogleTokenStore(supabase),
    bootstrapGoogleTokenStateFromEnv(env),
  );
  return new YouTubeAdapter(clientId, clientSecret, tokenStore);
}
