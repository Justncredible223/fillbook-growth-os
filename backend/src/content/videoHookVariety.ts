/**
 * Keeps new video hooks from repeating recent ones. Owner review of the live
 * channels (2026-09-20) found "You already know which trade you're about to
 * repeat" opening 4 of the last 16 TikToks -- the script prompt used it as its
 * own example, so the model kept copying it -- and all four sat below the
 * channel's typical views. Deterministic and $0, like the reply guardrails: it
 * only catches openings that are clearly the same, and leaves "is this a good
 * hook" to the writer prompt.
 */

/** How many opening words two hooks may share before they count as the same opening. */
const SHARED_OPENING_WORDS = 4;
/** Word-overlap (Jaccard) at or above this counts as the same hook even when the opening differs. */
const SIMILARITY_THRESHOLD = 0.6;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** The recent hook this one repeats, or null if it is fresh. */
export function findRepeatedHook(hook: string, recentHooks: readonly string[]): string | null {
  const hookWords = words(hook);
  if (hookWords.length === 0) return null;
  const opening = hookWords.slice(0, SHARED_OPENING_WORDS).join(" ");
  for (const recent of recentHooks) {
    const recentWords = words(recent);
    if (recentWords.length === 0) continue;
    const sameOpening = hookWords.length >= SHARED_OPENING_WORDS && recentWords.length >= SHARED_OPENING_WORDS && recentWords.slice(0, SHARED_OPENING_WORDS).join(" ") === opening;
    if (sameOpening || jaccard(hookWords, recentWords) >= SIMILARITY_THRESHOLD) return recent;
  }
  return null;
}

export interface RecentVideo {
  hook: string;
  title: string;
}

/** The prompt section listing what the writer must not echo. Empty string when there is no history. */
export function formatRecentVideos(recent: readonly RecentVideo[]): string {
  if (recent.length === 0) return "";
  const lines = recent.map((video) => `- Hook: ${video.hook}${video.title ? ` | Title: ${video.title}` : ""}`);
  return [
    "RECENT VIDEOS (already published -- do not reuse or closely echo any of these hooks, openings or angles; find a different mechanic or a different consequence for this topic):",
    ...lines,
  ].join("\n");
}
