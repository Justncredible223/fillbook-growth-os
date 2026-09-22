import type { SupabaseClient } from "@supabase/supabase-js";
import type { YoutubeTokenState, YoutubeTokenStore } from "./youtubeTokenStore.js";
import {
  BootstrappingYoutubeTokenStore,
  SupabaseYoutubeTokenStore,
  bootstrapYoutubeTokenStateFromEnv,
} from "./youtubeTokenStore.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ANALYTICS_ENDPOINT = "https://youtubeanalytics.googleapis.com/v2/reports";
const REFRESH_SAFETY_MARGIN_MS = 60_000;

// Order here MUST match METRICS below -- fetchVideoMetrics zips the two.
const METRICS = [
  "views",
  "likes",
  "comments",
  "shares",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
] as const;

export class YoutubeAnalyticsError extends Error {}

export interface YoutubeVideoAnalytics {
  videoId: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  estimatedMinutesWatched: number | null;
  averageViewDurationSeconds: number | null;
  /** 0-100+ (a looping Short can exceed 100). */
  averageViewPercentage: number | null;
  subscribersGained: number | null;
  subscribersLost: number | null;
}

/**
 * Reads YouTube Analytics (the separate youtubeanalytics.googleapis.com
 * API, not YouTube Data API v3) for the authorized channel's own videos.
 * `ids=channel==MINE` needs no channel id on file -- it resolves to
 * whichever channel the OAuth token belongs to.
 */
export class YoutubeAnalyticsClient {
  constructor(
    private clientId: string,
    private clientSecret: string,
    private tokenStore: YoutubeTokenStore,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async getValidAccessToken(now: Date = new Date()): Promise<string> {
    const state = await this.tokenStore.load();
    if (!state) {
      throw new YoutubeAnalyticsError(
        "No YouTube OAuth tokens stored. Authorize via the OAuth consent flow with the " +
          "yt-analytics.readonly scope first (see youtubeUploadClient.ts's own doc comment).",
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
      throw new YoutubeAnalyticsError(`YouTube token refresh failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: json.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + json.expires_in * 1000),
    };
  }

  /**
   * One report call covering every requested video id (comma-joined into
   * a single `filters=video==...` value, which is how this API expresses
   * an OR over ids) rather than one call per video -- keeps this well
   * under YouTube Analytics' daily quota regardless of how many videos
   * have been published so far. A video with no rows in the response
   * (e.g. published too recently for YouTube to have processed stats yet)
   * is simply absent from the returned array, not a zeroed-out entry.
   */
  async fetchVideoMetrics(
    videoIds: string[],
    startDate: string,
    endDate: string,
    now: Date = new Date(),
  ): Promise<YoutubeVideoAnalytics[]> {
    if (videoIds.length === 0) return [];
    const token = await this.getValidAccessToken(now);

    const url = new URL(ANALYTICS_ENDPOINT);
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", endDate);
    url.searchParams.set("metrics", METRICS.join(","));
    url.searchParams.set("dimensions", "video");
    url.searchParams.set("filters", `video==${videoIds.join(",")}`);

    const res = await this.fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new YoutubeAnalyticsError(`YouTube Analytics report failed: HTTP ${res.status} -- ${body}`);
    }
    const json = (await res.json()) as { rows?: Array<[string, ...number[]]> };

    return (json.rows ?? []).map((row) => {
      const [videoId, ...values] = row;
      const byMetric = Object.fromEntries(METRICS.map((m, i) => [m, values[i] ?? null])) as Record<
        (typeof METRICS)[number],
        number | null
      >;
      return {
        videoId,
        views: byMetric.views,
        likes: byMetric.likes,
        comments: byMetric.comments,
        shares: byMetric.shares,
        estimatedMinutesWatched: byMetric.estimatedMinutesWatched,
        averageViewDurationSeconds: byMetric.averageViewDuration,
        averageViewPercentage: byMetric.averageViewPercentage,
        subscribersGained: byMetric.subscribersGained,
        subscribersLost: byMetric.subscribersLost,
      };
    });
  }
}

export function createYoutubeAnalyticsClient(
  supabase: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): YoutubeAnalyticsClient {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new YoutubeAnalyticsError("GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET are not set in the environment.");
  }
  const tokenStore = new BootstrappingYoutubeTokenStore(
    new SupabaseYoutubeTokenStore(supabase),
    bootstrapYoutubeTokenStateFromEnv(env),
  );
  return new YoutubeAnalyticsClient(clientId, clientSecret, tokenStore);
}
