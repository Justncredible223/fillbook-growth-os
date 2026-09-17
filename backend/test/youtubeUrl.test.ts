import { describe, it, expect } from "vitest";
import { extractYoutubeVideoId } from "../src/video/youtubeUrl";

describe("extractYoutubeVideoId", () => {
  it("extracts from a standard /watch?v= URL", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a /watch?v= URL with extra query params (e.g. a playlist/timestamp)", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=PL123")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a youtu.be short link", () => {
    expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a youtu.be short link with a trailing query string", () => {
    expect(extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=5")).toBe("dQw4w9WgXcQ");
  });

  it("extracts from a /shorts/ URL -- the format most of this app's own renders get posted as", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("works without the www. subdomain, and with m.youtube.com", () => {
    expect(extractYoutubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYoutubeVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("trims surrounding whitespace the owner might paste in by accident", () => {
    expect(extractYoutubeVideoId("  https://youtu.be/dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for a non-YouTube URL (e.g. TikTok or Instagram, pasted into the same generic field)", () => {
    expect(extractYoutubeVideoId("https://www.tiktok.com/@fillbookhq/video/1234567890")).toBeNull();
    expect(extractYoutubeVideoId("https://www.instagram.com/reel/abc123/")).toBeNull();
  });

  it("returns null for a malformed/unparseable string rather than throwing", () => {
    expect(extractYoutubeVideoId("not a url at all")).toBeNull();
    expect(extractYoutubeVideoId("")).toBeNull();
  });

  it("returns null for a YouTube URL with no real video id (e.g. the bare channel homepage)", () => {
    expect(extractYoutubeVideoId("https://www.youtube.com/@fillbookhq")).toBeNull();
    expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=")).toBeNull();
  });
});
