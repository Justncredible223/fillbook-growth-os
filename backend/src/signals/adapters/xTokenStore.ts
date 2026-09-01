import type { SupabaseClient } from "@supabase/supabase-js";

export interface XTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Persists the X OAuth 2.0 token pair between adapter runs. Env vars
 * (X_ACCESS_TOKEN/X_REFRESH_TOKEN) only bootstrap the very first run --
 * after that, the refreshed tokens live here, since a serverless
 * invocation can't write back to its own env vars.
 */
export interface XTokenStore {
  load(): Promise<XTokenState | null>;
  save(state: XTokenState): Promise<void>;
}

export class InMemoryXTokenStore implements XTokenStore {
  constructor(private state: XTokenState | null = null) {}

  async load(): Promise<XTokenState | null> {
    return this.state;
  }

  async save(state: XTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

/**
 * Wraps any XTokenStore and seeds it from env-var values the first time
 * load() finds nothing there yet. This is how X_ACCESS_TOKEN/
 * X_REFRESH_TOKEN in .env.local (or Vercel's env vars) get into
 * platform_oauth_credentials without ever needing a secret typed into a
 * SQL statement or a deploy script -- the app seeds itself on first use.
 */
export class BootstrappingXTokenStore implements XTokenStore {
  constructor(
    private inner: XTokenStore,
    private bootstrap: XTokenState | null,
  ) {}

  async load(): Promise<XTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: XTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

/**
 * Builds the bootstrap token state from env vars, if all three are
 * present. expiresInMinutes defaults conservatively short (X access
 * tokens are only valid ~2h) -- worst case this triggers one extra
 * refresh sooner than strictly necessary, which is harmless.
 */
export function bootstrapXTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): XTokenState | null {
  const accessToken = env.X_ACCESS_TOKEN;
  const refreshToken = env.X_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    // We don't know exactly when the env-provided access token was minted,
    // so treat it as already due for refresh -- the refresh token is what
    // actually matters for a bootstrap.
    expiresAt: new Date(0),
  };
}

export class SupabaseXTokenStore implements XTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<XTokenState | null> {
    const { data, error } = await this.client
      .from("platform_oauth_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("platform", "x")
      .maybeSingle();
    if (error) throw new Error(`load X token state failed: ${error.message}`);
    if (!data) return null;
    const row = data as CredentialRow;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async save(state: XTokenState): Promise<void> {
    const { error } = await this.client.from("platform_oauth_credentials").upsert({
      platform: "x",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save X token state failed: ${error.message}`);
  }
}
