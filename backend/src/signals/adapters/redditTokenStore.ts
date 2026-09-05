import type { SupabaseClient } from "@supabase/supabase-js";

export interface RedditTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Persists the Reddit OAuth 2.0 token pair between adapter runs -- same
 * bootstrap-then-self-persist shape as xTokenStore.ts.
 * Env vars (REDDIT_ACCESS_TOKEN/REDDIT_REFRESH_TOKEN) only bootstrap the
 * very first run; after that, refreshed tokens live in
 * platform_oauth_credentials (platform="reddit", same table every other
 * adapter already uses -- no new migration needed).
 */
export interface RedditTokenStore {
  load(): Promise<RedditTokenState | null>;
  save(state: RedditTokenState): Promise<void>;
}

export class InMemoryRedditTokenStore implements RedditTokenStore {
  constructor(private state: RedditTokenState | null = null) {}

  async load(): Promise<RedditTokenState | null> {
    return this.state;
  }

  async save(state: RedditTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export class BootstrappingRedditTokenStore implements RedditTokenStore {
  constructor(
    private inner: RedditTokenStore,
    private bootstrap: RedditTokenState | null,
  ) {}

  async load(): Promise<RedditTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: RedditTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

/** Builds the bootstrap token state from env vars, if both are present. Treated as already due for refresh (expiresAt = epoch) since we don't know when the env-provided token was minted -- the refresh token is what actually matters for a bootstrap. */
export function bootstrapRedditTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): RedditTokenState | null {
  const accessToken = env.REDDIT_ACCESS_TOKEN;
  const refreshToken = env.REDDIT_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, expiresAt: new Date(0) };
}

export class SupabaseRedditTokenStore implements RedditTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<RedditTokenState | null> {
    const { data, error } = await this.client
      .from("platform_oauth_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("platform", "reddit")
      .maybeSingle();
    if (error) throw new Error(`load Reddit token state failed: ${error.message}`);
    if (!data) return null;
    const row = data as CredentialRow;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async save(state: RedditTokenState): Promise<void> {
    const { error } = await this.client.from("platform_oauth_credentials").upsert({
      platform: "reddit",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save Reddit token state failed: ${error.message}`);
  }
}
