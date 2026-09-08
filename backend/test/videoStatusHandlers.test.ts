import { describe, it, expect } from "vitest";
import { parseVideoRenderMetadata } from "../src/video/videoStatusHandlers";

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
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
    },
  };

  it("extracts the platform-specific fields from a well-formed videoScript", () => {
    expect(parseVideoRenderMetadata(wellFormed)).toEqual({
      youtubeTitle: "A real YouTube title",
      youtubeDescription: "A real YouTube description.",
      tiktokCaption: "A real TikTok caption.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
    });
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
