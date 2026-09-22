import type { SupabaseClient } from "@supabase/supabase-js";

export interface YoutubeTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Same shape and reasoning as GoogleTokenStore/XTokenStore -- persists the
 * OAuth token pair used for automated YouTube publishing + Analytics
 * pull-back between invocations. Stored as its own platform="youtube" row,
 * SEPARATE from platform="google" (the Search Console token): a Google
 * refresh token is minted with a fixed scope set at consent time, and the
 * Search Console token was authorized with only webmasters.readonly, not
 * youtube.upload/yt-analytics.readonly -- reusing it here would fail with
 * insufficient_scope on every call. Minted under its own dedicated OAuth
 * client (YOUTUBE_OAUTH_CLIENT_ID/SECRET), not GOOGLE_OAUTH_CLIENT_ID/SECRET:
 * the Google Cloud console's redesigned Credentials UI no longer exposes a
 * way to view or reset an existing client's secret, so reusing the Search
 * Console client wasn't an option once its secret was lost.
 */
export interface YoutubeTokenStore {
  load(): Promise<YoutubeTokenState | null>;
  save(state: YoutubeTokenState): Promise<void>;
}

export class InMemoryYoutubeTokenStore implements YoutubeTokenStore {
  constructor(private state: YoutubeTokenState | null = null) {}

  async load(): Promise<YoutubeTokenState | null> {
    return this.state;
  }

  async save(state: YoutubeTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export class SupabaseYoutubeTokenStore implements YoutubeTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<YoutubeTokenState | null> {
    const { data, error } = await this.client
      .from("platform_oauth_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("platform", "youtube")
      .maybeSingle();
    if (error) throw new Error(`load YouTube token state failed: ${error.message}`);
    if (!data) return null;
    const row = data as CredentialRow;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async save(state: YoutubeTokenState): Promise<void> {
    const { error } = await this.client.from("platform_oauth_credentials").upsert({
      platform: "youtube",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save YouTube token state failed: ${error.message}`);
  }
}

export class BootstrappingYoutubeTokenStore implements YoutubeTokenStore {
  constructor(
    private inner: YoutubeTokenStore,
    private bootstrap: YoutubeTokenState | null,
  ) {}

  async load(): Promise<YoutubeTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: YoutubeTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

export function bootstrapYoutubeTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): YoutubeTokenState | null {
  const accessToken = env.YOUTUBE_ACCESS_TOKEN;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    // Same reasoning as bootstrapGoogleTokenStateFromEnv: unknown mint time,
    // so treat as already due for refresh.
    expiresAt: new Date(0),
  };
}
