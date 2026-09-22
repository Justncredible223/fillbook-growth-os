import type { SupabaseClient } from "@supabase/supabase-js";
import type { YoutubeTokenState, YoutubeTokenStore } from "./youtubeTokenStore.js";
import {
  BootstrappingYoutubeTokenStore,
  SupabaseYoutubeTokenStore,
  bootstrapYoutubeTokenStateFromEnv,
} from "./youtubeTokenStore.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/youtube/v3/videos";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

export class YoutubeUploadError extends Error {}

export interface YoutubeUploadInput {
  title: string;
  description: string;
  /** Raw MP4 bytes, already downloaded from Supabase Storage. */
  fileBytes: Buffer;
  /**
   * "public" | "unlisted" | "private" -- defaults to "private". Automated
   * uploads must never go live on their own (see
   * docs/EXTERNAL_WRITE_FIREWALL.md): "private" is the only privacyStatus
   * that isn't publicly reachable, so it's the only one this client will
   * default to without the caller explicitly overriding it.
   */
  privacyStatus?: "public" | "unlisted" | "private";
  /** YouTube category id. "22" = People & Blogs, a reasonable default for talking-through-a-trade content. */
  categoryId?: string;
}

/**
 * Uploads a finished video via YouTube Data API v3's resumable upload
 * protocol (videos.insert): one POST to open the session (returns a
 * `Location` session URI), then one PUT with the file bytes. Deliberately
 * a single PUT rather than chunked upload -- rendered Shorts are small
 * (well under a minute, single-digit MB) so the whole file fits in one
 * request comfortably; chunking only pays for itself with much larger
 * files or flaky connections, neither of which applies here yet.
 */
export class YoutubeUploadClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private tokenStore: YoutubeTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new YoutubeUploadError(
        "No YouTube OAuth tokens stored. Authorize via the OAuth consent flow with the " +
          "youtube.upload and yt-analytics.readonly scopes, as the Google account that owns the " +
          "target YouTube channel, then seed platform_oauth_credentials via " +
          "YOUTUBE_ACCESS_TOKEN/YOUTUBE_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<YoutubeTokenState> {
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
      throw new YoutubeUploadError(`YouTube token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: json.access_token,
      // Google's refresh flow doesn't rotate the refresh token itself.
      refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  async uploadVideo(input: YoutubeUploadInput, now: Date = new Date()): Promise<string> {
    const token = await this.getValidAccessToken(now);

    const sessionRes = await this.fetchImpl(`${UPLOAD_ENDPOINT}?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(input.fileBytes.length),
      },
      body: JSON.stringify({
        snippet: {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId ?? "22",
        },
        status: {
          privacyStatus: input.privacyStatus ?? "private",
          selfDeclaredMadeForKids: false,
        },
      }),
    });
    if (!sessionRes.ok) {
      const body = await sessionRes.text();
      throw new YoutubeUploadError(`YouTube upload session init failed: HTTP ${sessionRes.status} -- ${body}`);
    }
    const sessionUri = sessionRes.headers.get("location");
    if (!sessionUri) {
      throw new YoutubeUploadError("YouTube upload session init succeeded but returned no Location header.");
    }

    const uploadRes = await this.fetchImpl(sessionUri, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "video/mp4",
        "Content-Length": String(input.fileBytes.length),
      },
      // Buffer isn't in fetch's BodyInit type in this project's lib target
      // even though Node's fetch accepts it fine at runtime -- a plain
      // Uint8Array view over the same bytes satisfies both.
      body: new Uint8Array(input.fileBytes),
    });
    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new YoutubeUploadError(`YouTube video upload failed: HTTP ${uploadRes.status} -- ${body}`);
    }
    const json = (await uploadRes.json()) as { id?: string };
    if (!json.id) {
      throw new YoutubeUploadError("YouTube video upload succeeded but the response had no video id.");
    }
    return json.id;
  }
}

export function createYoutubeUploadClient(
  supabase: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): YoutubeUploadClient {
  const clientId = env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new YoutubeUploadError("YOUTUBE_OAUTH_CLIENT_ID/YOUTUBE_OAUTH_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingYoutubeTokenStore(
    new SupabaseYoutubeTokenStore(supabase),
    bootstrapYoutubeTokenStateFromEnv(env),
  );
  return new YoutubeUploadClient(clientId, clientSecret, tokenStore);
}
