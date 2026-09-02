import type { SupabaseClient } from "@supabase/supabase-js";

export interface TikTokTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Same shape and reasoning as XTokenStore -- persists the TikTok OAuth
 * token pair between adapter runs. Env vars (TIKTOK_ACCESS_TOKEN/
 * TIKTOK_REFRESH_TOKEN) only bootstrap the very first run -- after that,
 * the refreshed tokens live here, since a serverless invocation can't
 * write back to its own env vars. Stored as platform="tiktok" in the same
 * platform_oauth_credentials table the X and Google adapters use.
 */
export interface TikTokTokenStore {
  load(): Promise<TikTokTokenState | null>;
  save(state: TikTokTokenState): Promise<void>;
}

export class InMemoryTikTokTokenStore implements TikTokTokenStore {
  constructor(private state: TikTokTokenState | null = null) {}

  async load(): Promise<TikTokTokenState | null> {
    return this.state;
  }

  async save(state: TikTokTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export class SupabaseTikTokTokenStore implements TikTokTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<TikTokTokenState | null> {
    const { data, error } = await this.client
      .from("platform_oauth_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("platform", "tiktok")
      .maybeSingle();
    if (error) throw new Error(`load TikTok token state failed: ${error.message}`);
    if (!data) return null;
    const row = data as CredentialRow;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async save(state: TikTokTokenState): Promise<void> {
    const { error } = await this.client.from("platform_oauth_credentials").upsert({
      platform: "tiktok",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save TikTok token state failed: ${error.message}`);
  }
}

export class BootstrappingTikTokTokenStore implements TikTokTokenStore {
  constructor(
    private inner: TikTokTokenStore,
    private bootstrap: TikTokTokenState | null,
  ) {}

  async load(): Promise<TikTokTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: TikTokTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

/**
 * Builds the bootstrap token state from env vars, if both are present.
 * TikTok access tokens are only valid ~24h, so -- same reasoning as
 * bootstrapXTokenStateFromEnv -- this treats the bootstrap value as
 * already due for refresh rather than guessing when it was minted.
 */
export function bootstrapTikTokTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): TikTokTokenState | null {
  const accessToken = env.TIKTOK_ACCESS_TOKEN;
  const refreshToken = env.TIKTOK_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(0),
  };
}
