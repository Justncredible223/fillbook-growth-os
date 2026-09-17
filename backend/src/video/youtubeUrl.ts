/**
 * Extracts a YouTube video id from any of the URL shapes a person
 * actually pastes: youtu.be short links, /watch?v=, and /shorts/ (the
 * format most of this app's own renders get posted as, being vertical
 * short-form video). Returns null for anything else -- a TikTok or
 * Instagram URL pasted into the same "posted URL" field, a malformed
 * string, or a YouTube URL shape this doesn't recognize -- rather than
 * guessing, since a wrong id would poll the wrong video's comments.
 */
export function extractYoutubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

  if (host === "youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0] ?? "";
    return VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v") ?? "";
      return VIDEO_ID_PATTERN.test(id) ? id : null;
    }
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1]!;
  }

  return null;
}
