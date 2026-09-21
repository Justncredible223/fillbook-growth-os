/**
 * Hook diversity + top-performer seeds for short-form video scripts
 * (2026-09-21). A public look at @fillbookhq showed about a dozen TikToks
 * opening with near-identical lines ("You already know which trade you're
 * about to repeat..."). Root cause: the script prompt itself contained that
 * exact line as an example, twice, and the model kept reusing it; the
 * pipeline's originality check compared whole-script bodies of recent
 * content of ALL types, which never catches a repeated hook. This module
 * gives the writer (1) a rotating hook format so consecutive videos differ
 * in structure, (2) the recent + already-published hooks to avoid, (3)
 * what has actually performed, and (4) a mechanical check that rejects a
 * hook too close to a recent one.
 */

export interface HookFormat {
  id: string;
  name: string;
  /** Abstract pattern, deliberately not a copyable example line. */
  pattern: string;
}

/** Structurally distinct openers. Rotated so back-to-back videos never share one. */
export const HOOK_FORMATS: HookFormat[] = [
  { id: "rule_mechanic", name: "Rule mechanic", pattern: "State one specific prop-firm rule mechanic in a single flat sentence, then the consequence most traders miss." },
  { id: "two_part_contrast", name: "Two-part contrast", pattern: "Something traders believe helps, followed by what it actually costs them, in two short sentences." },
  { id: "scenario_clock", name: "Moment in time", pattern: "Drop the viewer into an exact moment of a trading day (a time, a screen, a position) and what they are about to do." },
  { id: "myth_flip", name: "Myth flip", pattern: "Name a piece of common advice, then say in one line why it fails for funded accounts." },
  { id: "named_mistake", name: "Named mistake", pattern: "Give a mistake a short, memorable name and say what it looks like in the moment." },
  { id: "real_question", name: "Real trader question", pattern: "Ask the exact question a funded trader types into search or a Discord after a bad day." },
  { id: "small_number", name: "One checkable number", pattern: "Lead with one concrete number or dollar figure taken ONLY from the verified knowledge, then what it means." },
];

/** Deterministic rotation: the day plus the topic decides the format, so consecutive runs differ and a rerun of the same topic is stable. */
export function pickHookFormat(now: Date, opportunityTitle: string, recentHooks: string[] = []): HookFormat {
  const day = Math.floor(now.getTime() / 86_400_000);
  let seed = 0;
  for (const ch of opportunityTitle) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const start = (day + seed) % HOOK_FORMATS.length;
  // Prefer the first rotation slot whose signature does not already dominate the recent hooks.
  for (let i = 0; i < HOOK_FORMATS.length; i++) {
    const candidate = HOOK_FORMATS[(start + i) % HOOK_FORMATS.length]!;
    const used = recentHooks.filter((h) => matchesFormatSignature(h, candidate.id)).length;
    if (used < 2) return candidate;
  }
  return HOOK_FORMATS[start]!;
}

/** Cheap, conservative signatures, only used to avoid piling up the same shape; never to classify for display. */
function matchesFormatSignature(hook: string, formatId: string): boolean {
  const h = hook.trim().toLowerCase();
  switch (formatId) {
    case "two_part_contrast":
      return /^you\b.*\bbut never\b|^you(?:'re| are) not\b.*\byou(?:'re| are)\b/.test(h);
    case "real_question":
      return h.endsWith("?");
    case "scenario_clock":
      return /^(it'?s|at)\s+\d/.test(h);
    case "myth_flip":
      return /^(everyone|they) (says?|tells?)|^the advice\b/.test(h);
    default:
      return false;
  }
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function openingWords(text: string, n: number): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .join(" ");
}

export interface HookSimilarity {
  similar: boolean;
  against?: string;
  reason?: string;
}

/**
 * True when a hook is too close to a recent/published one: the same first
 * four words, or heavy word overlap. Short hooks are compared on their
 * first four words only, since two different short hooks can overlap by
 * accident on a couple of common words.
 */
export function checkHookSimilarity(hook: string, recentHooks: string[], jaccardThreshold = 0.5): HookSimilarity {
  const opening = openingWords(hook, 4);
  const mine = tokens(hook);
  for (const other of recentHooks) {
    if (!other.trim()) continue;
    if (opening.split(" ").length >= 4 && opening === openingWords(other, 4)) {
      return { similar: true, against: other, reason: "opens with the same first four words" };
    }
    const theirs = tokens(other);
    if (mine.size < 4 || theirs.size < 4) continue;
    let inter = 0;
    for (const t of mine) if (theirs.has(t)) inter++;
    const jaccard = inter / (mine.size + theirs.size - inter);
    if (jaccard >= jaccardThreshold) return { similar: true, against: other, reason: `${Math.round(jaccard * 100)}% word overlap` };
  }
  return { similar: false };
}

/**
 * What has actually performed on @fillbookhq, from a public look on
 * 2026-09-21 (view counts as displayed then). Openings only, truncated as
 * shown on the profile grid. Used both as "what worked" evidence for the
 * writer and as already-published hooks that must not be repeated.
 */
export interface TopPerformer {
  platform: "tiktok" | "youtube";
  views: number;
  opening: string;
  /** Why it plausibly worked, so the writer copies the mechanism and never the words. */
  mechanism: string;
}

export const TOP_PERFORMERS: TopPerformer[] = [
  { platform: "youtube", views: 394, opening: "Why Prop Traders Who Track Their Trades Keep Their Accounts Longer", mechanism: "Names the audience (prop traders) and a concrete outcome (keeping the account); a search-shaped title." },
  { platform: "tiktok", views: 301, opening: "You pass the eval because the rules are tight. You keep the", mechanism: "Two-part contrast between passing an evaluation and keeping a funded account, anchored in real rule structure." },
  { platform: "tiktok", views: 197, opening: "Your trading plan needs enforcement, not just good intention", mechanism: "Names a specific gap (intention vs enforcement) a funded trader recognizes in themselves." },
  { platform: "tiktok", views: 169, opening: "You replay your losses but never review your wins", mechanism: "A relatable behavior pattern stated as a flat observation, no question." },
  { platform: "tiktok", views: 157, opening: "You're not backtesting to prove the setup works. You're backtesting", mechanism: "Reframes a familiar activity. Works, but this exact shape has been used already, so vary it." },
  { platform: "tiktok", views: 141, opening: "Daily loss limit resets. Trailing drawdown doesn't. Most fun", mechanism: "A concrete rule fact in short sentences that the viewer can check against their own firm." },
];

/** Hook openings already published (all TikTok videos seen on the profile), used purely to avoid repeats. */
export const KNOWN_PUBLISHED_HOOKS: string[] = [
  ...TOP_PERFORMERS.map((p) => p.opening),
  "You already know which rule you're about to break. You just",
  "You already know which trade you're about to repeat. Tag exe",
  "You already know which trade you're about to repeat. You jus",
  "You already know which trade you're about to repeat. A good",
  "You break your rules because you don't remember breaking them",
  "Your brain forgets the bad trade in 24 hours. A journal remembers",
  "Your platform shows equity. Your prop firm tracks trailing m",
  "Four losses in a row feels random until you filter by setup",
];

/** The prompt section handed to the writer: format for this run, hooks to avoid, evidence of what worked. */
export function buildHookGuidance(opts: { format: HookFormat; recentHooks: string[] }): string {
  const avoid = [...new Set([...opts.recentHooks, ...KNOWN_PUBLISHED_HOOKS])].filter((h) => h.trim()).slice(0, 40);
  const worked = TOP_PERFORMERS.map((p) => `- ${p.views} views on ${p.platform}: "${p.opening}" (${p.mechanism})`).join("\n");
  return [
    "HOOK FOR THIS VIDEO (variety is a ranking factor: the account has repeated the same opener too many times):",
    `Use this hook format: ${opts.format.name}. ${opts.format.pattern}`,
    "Write a fresh hook for THIS topic. Do not reuse the wording, the first four words, or the sentence shape of any hook below.",
    "",
    "Hooks already used or published, never repeat or lightly reword these:",
    ...avoid.map((h) => `- ${h}`),
    "",
    "What has performed best so far (learn the mechanism, never copy the words):",
    worked,
  ].join("\n");
}
