import type { SupabaseClient } from "@supabase/supabase-js";

export interface TiktokTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Same shape and reasoning as YoutubeTokenStore -- persists the OAuth token
 * pair used for the TikTok Content Posting API between invocations. Own
 * platform="tiktok" row. Unlike Google's refresh flow, TikTok ROTATES the
 * refresh token on every use (its docs: "the refresh token... is also
 * updated" on each refresh_token grant) -- callers that refresh MUST save
 * the new refresh_token this store returns, not reuse the old one, or the
 * next refresh will fail with an already-invalidated token.
 */
export interface TiktokTokenStore {
  load(): Promise<TiktokTokenState | null>;
  save(state: TiktokTokenState): Promise<void>;
}

export class InMemoryTiktokTokenStore implements TiktokTokenStore {
  constructor(private state: TiktokTokenState | null = null) {}

  async load(): Promise<TiktokTokenState | null> {
    return this.state;
  }

  async save(state: TiktokTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export class SupabaseTiktokTokenStore implements TiktokTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<TiktokTokenState | null> {
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

  async save(state: TiktokTokenState): Promise<void> {
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

export class BootstrappingTiktokTokenStore implements TiktokTokenStore {
  constructor(
    private inner: TiktokTokenStore,
    private bootstrap: TiktokTokenState | null,
  ) {}

  async load(): Promise<TiktokTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: TiktokTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

export function bootstrapTiktokTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): TiktokTokenState | null {
  const accessToken = env.TIKTOK_ACCESS_TOKEN;
  const refreshToken = env.TIKTOK_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    // Unknown mint time, so treat as already due for refresh.
    expiresAt: new Date(0),
  };
}
