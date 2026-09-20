import { describe, it, expect } from "vitest";
import { parseVideoRenderMetadata, setPublishedUrl, VideoStatusActionError } from "../src/video/videoStatusHandlers";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";

/**
 * Regression coverage for the "Create Fillbook Video" feature (2026-09-08):
 * Video Status now surfaces the platform-specific publishing metadata
 * (YouTube title/description, TikTok caption, hashtags, disclosure/CTA)
 * generated alongside the video script, so the owner can copy it straight
 * from the app instead of re-deriving it from the flattened Approvals text.
 * parseVideoRenderMetadata is the pure parsing logic, independent of
 * Supabase, that decides whether a given content_versions.metadata blob
 * has a well-formed videoScript to surface.
 */
describe("parseVideoRenderMetadata", () => {
  const wellFormed = {
    videoScript: {
      hook: "hook text",
      script: "full script",
      shotList: ["shot 1"],
      youtubeTitle: "A real YouTube title",
      youtubeDescription: "A real YouTube description.",
      tiktokCaption: "A real TikTok caption.",
      instagramCaption: "A real Instagram caption.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
      youtubeThumbnailConcept: "Bold text overlay over a split-screen visual.",
    },
  };

  it("extracts the platform-specific fields from a well-formed videoScript", () => {
    expect(parseVideoRenderMetadata(wellFormed)).toEqual({
      youtubeTitle: "A real YouTube title",
      youtubeDescription: "A real YouTube description.",
      tiktokCaption: "A real TikTok caption.",
      instagramCaption: "A real Instagram caption.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
      youtubeThumbnailConcept: "Bold text overlay over a split-screen visual.",
    });
  });

  it("normalizes a missing/non-string instagramCaption to null rather than fabricating one -- e.g. a render predating this field", () => {
    const { instagramCaption, ...rest } = wellFormed.videoScript;
    void instagramCaption;
    const result = parseVideoRenderMetadata({ videoScript: rest });
    expect(result?.instagramCaption).toBeNull();
  });

  it("normalizes a missing/non-string disclosureCta to null rather than fabricating one", () => {
    const { disclosureCta, ...rest } = wellFormed.videoScript;
    void disclosureCta;
    const result = parseVideoRenderMetadata({ videoScript: rest });
    expect(result?.disclosureCta).toBeNull();
  });

  it("returns null when metadata has no videoScript at all -- e.g. a text-post asset, or a render created before this field existed", () => {
    expect(parseVideoRenderMetadata({})).toBeNull();
    expect(parseVideoRenderMetadata(null)).toBeNull();
    expect(parseVideoRenderMetadata(undefined)).toBeNull();
  });

  it("returns null rather than throwing on a malformed/partial videoScript object", () => {
    expect(parseVideoRenderMetadata({ videoScript: { hook: "only a hook" } })).toBeNull();
    expect(parseVideoRenderMetadata({ videoScript: "not an object" })).toBeNull();
    expect(parseVideoRenderMetadata({ videoScript: { ...wellFormed.videoScript, hashtags: "not an array" } })).toBeNull();
    expect(parseVideoRenderMetadata({ videoScript: { ...wellFormed.videoScript, hashtags: [1, 2] } })).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseVideoRenderMetadata("a string")).toBeNull();
    expect(parseVideoRenderMetadata(42)).toBeNull();
  });
});

/**
 * Growth loop (2026-09-18): setPublishedUrl is now also the entry point
 * into the generalized content_publications table (migration 0035), kept
 * in sync with the pre-existing video_renders.published_url column.
 */
describe("setPublishedUrl", () => {
  function client(renders: Record<string, any>[] = []) {
    return new FakeSupabaseClient({ video_renders: renders, content_publications: [] });
  }

  it("rejects a non-http(s) string without touching the database", async () => {
    const c = client();
    await expect(setPublishedUrl(asSupabase(c), "r1", "not a url")).rejects.toThrow(VideoStatusActionError);
    expect(c.queriesFor("video_renders")).toHaveLength(0);
  });

  it("throws when the render doesn't exist", async () => {
    const c = client([]);
    await expect(setPublishedUrl(asSupabase(c), "missing", "https://youtube.com/watch?v=abc12345678")).rejects.toThrow(/not found/);
  });

  it("refuses to record a URL for a render that isn't 'ready'", async () => {
    const c = client([{ id: "r1", status: "rendering", campaign_asset_id: "asset-1" }]);
    await expect(setPublishedUrl(asSupabase(c), "r1", "https://youtube.com/watch?v=abc12345678")).rejects.toThrow(/finished successfully/);
  });

  it("updates video_renders.published_url on a ready render", async () => {
    const c = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    await setPublishedUrl(asSupabase(c), "r1", "https://youtube.com/watch?v=abc12345678");
    const updateLog = c.queriesFor("video_renders").find((q) => q.op === "update");
    expect((updateLog?.payload as any)?.published_url).toBe("https://youtube.com/watch?v=abc12345678");
  });

  it("also upserts a content_publications row, detecting the channel from the URL", async () => {
    const c = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    await setPublishedUrl(asSupabase(c), "r1", "https://youtube.com/watch?v=abc12345678");
    const pub = c.queriesFor("content_publications").find((q) => q.op === "upsert");
    expect(pub?.payload).toMatchObject({ campaign_asset_id: "asset-1", channel: "youtube", actual_url: "https://youtube.com/watch?v=abc12345678" });
  });

  it("detects tiktok.com and instagram.com URLs correctly, and falls back to 'other' for an unrecognized host", async () => {
    const c1 = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    await setPublishedUrl(asSupabase(c1), "r1", "https://www.tiktok.com/@fillbookhq/video/123");
    expect((c1.queriesFor("content_publications").find((q) => q.op === "upsert")?.payload as any)?.channel).toBe("tiktok");

    const c2 = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    await setPublishedUrl(asSupabase(c2), "r1", "https://www.instagram.com/reel/abc123/");
    expect((c2.queriesFor("content_publications").find((q) => q.op === "upsert")?.payload as any)?.channel).toBe("instagram");

    const c3 = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    await setPublishedUrl(asSupabase(c3), "r1", "https://example.com/some-video");
    expect((c3.queriesFor("content_publications").find((q) => q.op === "upsert")?.payload as any)?.channel).toBe("other");
  });

  it("still updates video_renders even if the content_publications sync fails -- best-effort, never blocks the primary write", async () => {
    const c = client([{ id: "r1", status: "ready", campaign_asset_id: "asset-1" }]);
    c.failTable("content_publications", { message: "db down" }, "upsert");
    await expect(setPublishedUrl(asSupabase(c), "r1", "https://youtube.com/watch?v=abc12345678")).resolves.toBeUndefined();
    const updateLog = c.queriesFor("video_renders").find((q) => q.op === "update");
    expect((updateLog?.payload as any)?.published_url).toBe("https://youtube.com/watch?v=abc12345678");
  });

  it("skips the content_publications sync entirely when the render has no campaign_asset_id (older row)", async () => {
    const c = client([{ id: "r1", status: "ready", campaign_asset_id: null }]);
    await setPublishedUrl(asSupabase(c), "r1", "https://youtube.com/watch?v=abc12345678");
    expect(c.queriesFor("content_publications")).toHaveLength(0);
  });
});
