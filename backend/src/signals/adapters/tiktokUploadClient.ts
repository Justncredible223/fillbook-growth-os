import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BootstrappingTiktokTokenStore,
  SupabaseTiktokTokenStore,
  bootstrapTiktokTokenStateFromEnv,
  type TiktokTokenState,
  type TiktokTokenStore,
} from "./tiktokTokenStore.js";

const TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";
const INBOX_INIT_ENDPOINT = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/";
const REFRESH_SAFETY_MARGIN_MS = 60_000;
// TikTok requires chunk_size in [5MB, 64MB] unless the whole video is under
// 5MB (then chunk_size = video_size, one chunk). A single chunk covering
// the whole file works for either case as long as the file is <=64MB --
// comfortably true for this pipeline's short vertical clips. Multi-chunk
// upload isn't implemented: erroring above 64MB is safer than silently
// mis-chunking a request TikTok would reject anyway.
const MAX_SINGLE_CHUNK_BYTES = 64 * 1024 * 1024;

export class TiktokUploadError extends Error {}

export interface TiktokUploadInput {
  /** TikTok's inbox flow has no title/description fields -- the creator adds those themselves when they open the app to finish posting. */
  fileBytes: Buffer;
}

/**
 * Publishes to TikTok's "upload to inbox" endpoint, NOT Direct Post: this
 * places the video as a draft in the creator's TikTok inbox, requiring them
 * to open the app and manually review/caption/post it. This is deliberate,
 * not a limitation to work around -- see docs/EXTERNAL_WRITE_FIREWALL.md:
 * an automated EXTERNAL_WRITE (TikTok's Direct Post, which also requires
 * app audit approval for unaudited apps anyway) is permanently rejected by
 * this codebase, while a draft the owner must still act on is the
 * EXTERNAL_DRAFT this class exists to produce.
 */
export class TiktokUploadClient {
  constructor(
    private clientKey: string,
    private clientSecret: string,
    private tokenStore: TiktokTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new TiktokUploadError(
        "No TikTok OAuth tokens stored. Authorize via the OAuth consent flow with the video.publish " +
          "scope as the account that owns the TikTok channel, then seed TIKTOK_ACCESS_TOKEN/TIKTOK_REFRESH_TOKEN.",
      );
    }
    if (state.expiresAt.getTime() - now.getTime() > REFRESH_SAFETY_MARGIN_MS) {
      return state.accessToken;
    }
    const refreshed = await this.refreshAccessToken(state.refreshToken);
    await this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  private async refreshAccessToken(refreshToken: string): Promise<TiktokTokenState> {
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
      throw new TiktokUploadError(`TikTok token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token: string };
    return {
      accessToken: json.access_token,
      // TikTok rotates the refresh token on every use -- MUST persist the
      // new one, unlike Google/YouTube where it stays stable.
      refreshToken: json.refresh_token,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  /** Returns TikTok's publish_id for the queued draft (not a public video id -- nothing is public until the owner finishes posting in-app). */
  async uploadVideoToInbox(input: TiktokUploadInput, now: Date = new Date()): Promise<string> {
    const videoSize = input.fileBytes.length;
    if (videoSize > MAX_SINGLE_CHUNK_BYTES) {
      throw new TiktokUploadError(
        `Video is ${videoSize} bytes, over the ${MAX_SINGLE_CHUNK_BYTES}-byte single-chunk limit this client supports.`,
      );
    }
    const token = await this.getValidAccessToken(now);

    const initRes = await this.fetchImpl(INBOX_INIT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: videoSize,
          chunk_size: videoSize,
          total_chunk_count: 1,
        },
      }),
    });
    if (!initRes.ok) {
      const body = await initRes.text();
      throw new TiktokUploadError(`TikTok inbox init failed: HTTP ${initRes.status} -- ${body}`);
    }
    const initJson = (await initRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { code?: string; message?: string };
    };
    if (initJson.error && initJson.error.code !== "ok") {
      throw new TiktokUploadError(`TikTok inbox init returned an error: ${initJson.error.code} -- ${initJson.error.message}`);
    }
    const publishId = initJson.data?.publish_id;
    const uploadUrl = initJson.data?.upload_url;
    if (!publishId || !uploadUrl) {
      throw new TiktokUploadError("TikTok inbox init response had no publish_id/upload_url.");
    }

    const uploadRes = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes 0-${videoSize - 1}/${videoSize}`,
      },
      body: input.fileBytes,
    });
    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new TiktokUploadError(`TikTok video chunk upload failed: HTTP ${uploadRes.status} -- ${body}`);
    }

    return publishId;
  }
}

export function createTiktokUploadClient(supabase: SupabaseClient, env: NodeJS.ProcessEnv = process.env): TiktokUploadClient {
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new TiktokUploadError("TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingTiktokTokenStore(
    new SupabaseTiktokTokenStore(supabase),
    bootstrapTiktokTokenStateFromEnv(env),
  );
  return new TiktokUploadClient(clientKey, clientSecret, tokenStore);
}
