import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleTokenState, GoogleTokenStore } from "./googleTokenStore.js";
import {
  BootstrappingGoogleTokenStore,
  SupabaseGoogleTokenStore,
  bootstrapGoogleTokenStateFromEnv,
} from "./googleTokenStore.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export class GoogleApiError extends Error {}

export interface SearchConsoleQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Shared by both Google adapters (Search Console here, YouTube in
 * youtubeAdapter.ts) -- same client credentials, same token pair, same
 * refresh flow. Read-only by construction: only GET/POST-read endpoints,
 * nothing that could modify the property or channel.
 */
export class SearchConsoleAdapter {
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
          "Search Console property, then seed platform_oauth_credentials via " +
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
      // Google's refresh flow doesn't rotate the refresh token itself.
      refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  private async authedFetch(url: string, init: RequestInit, now: Date = new Date()): Promise<unknown> {
    const token = await this.getValidAccessToken(now);
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GoogleApiError(`Search Console API request failed: HTTP ${res.status} -- ${body}`);
    }
    return res.json();
  }

  /** Resolves the verified site property URL -- avoids hardcoding the exact registered format. */
  async resolveSiteUrl(now: Date = new Date()): Promise<string> {
    const json = (await this.authedFetch(
      "https://www.googleapis.com/webmasters/v3/sites",
      { method: "GET" },
      now,
    )) as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    const site = json.siteEntry?.[0];
    if (!site) throw new GoogleApiError("Search Console API returned no accessible sites");
    return site.siteUrl;
  }

  /** Query performance for the given date range. No cursor -- this is a periodic snapshot, not a discrete event stream. */
  async fetchTopQueries(
    siteUrl: string,
    startDate: string,
    endDate: string,
    rowLimit = 25,
    now: Date = new Date(),
  ): Promise<SearchConsoleQueryRow[]> {
    const json = (await this.authedFetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit }),
      },
      now,
    )) as { rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> };

    return (json.rows ?? []).map((row) => ({
      query: row.keys[0] ?? "",
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }));
  }
}

export function createSearchConsoleAdapter(
  supabase: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): SearchConsoleAdapter {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleApiError("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingGoogleTokenStore(
    new SupabaseGoogleTokenStore(supabase),
    bootstrapGoogleTokenStateFromEnv(env),
  );
  return new SearchConsoleAdapter(clientId, clientSecret, tokenStore);
}
