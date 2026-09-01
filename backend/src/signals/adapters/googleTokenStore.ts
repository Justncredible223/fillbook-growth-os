import type { SupabaseClient } from "@supabase/supabase-js";

export interface GoogleTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Same shape and reasoning as XTokenStore -- persists the Google OAuth
 * token pair (shared by the Search Console and YouTube adapters, since
 * they were authorized together under one client/consent grant) between
 * invocations. Stored as platform="google" in the same
 * platform_oauth_credentials table the X adapter uses.
 */
export interface GoogleTokenStore {
  load(): Promise<GoogleTokenState | null>;
  save(state: GoogleTokenState): Promise<void>;
}

export class InMemoryGoogleTokenStore implements GoogleTokenStore {
  constructor(private state: GoogleTokenState | null = null) {}

  async load(): Promise<GoogleTokenState | null> {
    return this.state;
  }

  async save(state: GoogleTokenState): Promise<void> {
    this.state = state;
  }
}

interface CredentialRow {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export class SupabaseGoogleTokenStore implements GoogleTokenStore {
  constructor(private client: SupabaseClient) {}

  async load(): Promise<GoogleTokenState | null> {
    const { data, error } = await this.client
      .from("platform_oauth_credentials")
      .select("access_token, refresh_token, expires_at")
      .eq("platform", "google")
      .maybeSingle();
    if (error) throw new Error(`load Google token state failed: ${error.message}`);
    if (!data) return null;
    const row = data as CredentialRow;
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: new Date(row.expires_at),
    };
  }

  async save(state: GoogleTokenState): Promise<void> {
    const { error } = await this.client.from("platform_oauth_credentials").upsert({
      platform: "google",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`save Google token state failed: ${error.message}`);
  }
}

export class BootstrappingGoogleTokenStore implements GoogleTokenStore {
  constructor(
    private inner: GoogleTokenStore,
    private bootstrap: GoogleTokenState | null,
  ) {}

  async load(): Promise<GoogleTokenState | null> {
    const existing = await this.inner.load();
    if (existing) return existing;
    if (!this.bootstrap) return null;
    await this.inner.save(this.bootstrap);
    return this.bootstrap;
  }

  async save(state: GoogleTokenState): Promise<void> {
    await this.inner.save(state);
  }
}

export function bootstrapGoogleTokenStateFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleTokenState | null {
  const accessToken = env.GOOGLE_ACCESS_TOKEN;
  const refreshToken = env.GOOGLE_REFRESH_TOKEN;
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    // Same reasoning as bootstrapXTokenStateFromEnv: unknown mint time,
    // so treat as already due for refresh.
    expiresAt: new Date(0),
  };
}
