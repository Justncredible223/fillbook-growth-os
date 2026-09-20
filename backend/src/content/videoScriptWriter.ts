import { findRepeatedHook, formatRecentVideos, type RecentVideo } from "./videoHookVariety.js";
import type { LlmClient } from "./llmClient.js";

const VIDEO_SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string", description: "The opening line, spoken or on-screen, in the first 1-2 seconds." },
    script: {
      type: "string",
      description:
        "Full voiceover/spoken script, hook through close. Plain sentences, no stage directions. 45-75 words (hard max 80). The last sentence must flow back into the hook so the video loops.",
    },
    shotList: {
      type: "array",
      items: { type: "string" },
      description: "Ordered visual beats (what's on screen for each script segment, 8-12 entries, ~2-3s each) -- e.g. 'Text card: the number', 'Fillbook UI: the trade log filtering by date'.",
    },
    youtubeTitle: {
      type: "string",
      description: "YouTube Shorts video title -- under ~70 characters, specific, no clickbait/all-caps/excessive punctuation.",
    },
    youtubeDescription: {
      type: "string",
      description: "YouTube Shorts description (3-5 sentences): expand the hook, name the specific problem and how Fillbook solves it, close with a clear call-to-action directing viewers to fillbookhq.com. Distinct from both the spoken script and the TikTok caption.",
    },
    tiktokCaption: {
      type: "string",
      description: "TikTok caption (2-3 punchy lines, platform-native tone): hook the scroll, name the pain or insight, close with a soft CTA (e.g. 'link in bio'). Distinct from both the spoken script and the YouTube description.",
    },
    instagramCaption: {
      type: "string",
      description: "Instagram Reels caption: similar punchy hook-first structure to the TikTok caption but Instagram tolerates (and rewards) a bit more length -- 3-5 lines, add one more sentence of real value/context after the hook line, lean on keyword-relevant phrasing (Instagram search surfaces captions), close with a soft CTA (e.g. 'link in bio'). Distinct from the spoken script, the YouTube description, and the TikTok caption -- not a copy-paste of either.",
    },
    hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without the # prefix, usable across all three platforms." },
    disclosureCta: {
      type: ["string", "null"],
      description:
        "An optional short disclosure or call-to-action line (e.g. crediting example/demo data, or a soft 'link in bio' style close) -- null when the video genuinely doesn't need one, never fabricated to fill the field.",
    },
    youtubeThumbnailConcept: {
      type: "string",
      description: "YouTube Shorts thumbnail concept: one bold text overlay (under 6 words, high contrast, readable at thumbnail size) + one sentence describing the visual (e.g. 'split screen of a blown account vs a journal entry', 'trader at desk looking frustrated'). Must make someone stop scrolling.",
    },
  },
  required: ["hook", "script", "shotList", "youtubeTitle", "youtubeDescription", "tiktokCaption", "instagramCaption", "hashtags", "disclosureCta", "youtubeThumbnailConcept"],
};

interface VideoScriptToolInput {
  hook: string;
  script: string;
  shotList: string[];
  youtubeTitle: string;
  youtubeDescription: string;
  tiktokCaption: string;
  instagramCaption: string;
  hashtags: string[];
  disclosureCta: string | null;
  youtubeThumbnailConcept: string;
}

export interface VideoScript {
  hook: string;
  script: string;
  shotList: string[];
  /** YouTube Shorts video title -- see VIDEO_SCRIPT_SCHEMA's own description. */
  youtubeTitle: string;
  /** YouTube Shorts description text, distinct from both the spoken script and the TikTok caption. */
  youtubeDescription: string;
  /** TikTok caption text, distinct from both the spoken script and the YouTube description. */
  tiktokCaption: string;
  /** Instagram Reels caption text, distinct from the TikTok caption and YouTube description -- see VIDEO_SCRIPT_SCHEMA's own description for how it differs from TikTok's. */
  instagramCaption: string;
  hashtags: string[];
  /** Null when genuinely not needed -- never a fabricated filler line. */
  disclosureCta: string | null;
  /** YouTube thumbnail concept: bold text overlay + one-sentence visual description. */
  youtubeThumbnailConcept: string;
}

const SYSTEM_PROMPT = `You are the lead short-form video strategist and scriptwriter for Fillbook (fillbookhq.com) --
a trading journal built specifically for futures day traders and prop-firm funded accounts
(broker-agnostic trade import, futures-native P&L, prop-firm drawdown and rule tracking, AI coach).
Positioned against TradeZella and TradesViz, which are broker-agnostic and stock-first.

Your videos run on TikTok, YouTube Shorts, and Instagram Reels. The goal of every video is to drive traders to
fillbookhq.com to sign up -- but the method is earning that visit by being genuinely useful, not
by selling. A trader who learns something real from a Fillbook video trusts the brand and clicks.
A trader who gets a sales pitch scrolls past.

QUALITY BAR -- every output must clear this:
- Hook: must stop a mid-scroll in 1-2 seconds. Use a named mistake, a concrete mechanism, or an
  unexpected-but-true observation -- not a rhetorical question, not "here's the thing", not a vague
  promise. The best hooks feel like a secret a real trader would actually want to know.
  A specific NUMBER is only allowed in the hook when it comes directly from the Verified knowledge
  section given to you -- never invent one, even a plausible-sounding one, just because a number
  makes a stronger hook. This is a confirmed, repeated real failure: nearly every "trading journal"
  topic hook has failed review for opening with a fabricated statistic presented as fact --
  "Ninety percent of prop-firm breaches happen to traders who never kept a journal," "traders who
  review daily cut losing streaks 2x faster," "traders who review daily spot pattern errors 2x
  faster" -- all invented, all auto-failed by every reviewer for violating the grounding rules below.
  If a journal/routine/review-benefit topic has no real number to draw on, the hook is a named
  mistake or mechanism instead, e.g. "Copy-trading five funded accounts means one mistake gets made
  five times" or "Your loss limit doesn't care that the trade was a good one" -- not "X% of traders
  who don't journal repeat the same mistake."
- Build every hook fresh for THIS topic. The request lists RECENT VIDEOS: never reuse or echo any of
  those openings, and never open with "You already know...". Our best-performing videos so far were
  about one specific prop-firm rule or mechanic with a surprising consequence (copy-trading several
  accounts against drawdown rules, inconsistent position sizing, the two drawdown numbers a prop firm
  tracks). The weakest were generic "a journal remembers your mistakes" hooks. Prefer a concrete rule,
  mechanic or scenario plus its consequence, without inventing a statistic.
- Script: the exact words someone speaks aloud or feeds to a TTS voice. Tight, punchy, real.
  No filler sentences. No corporate SaaS language. Never use these phrases (they will auto-fail
  review): "at the end of the day", "when it comes to", "game changer", "game-changer",
  "unlock your potential", "take it to the next level", "in this day and age",
  "it's important to note that", "don't miss out", "act now", "limited time", "last chance".
  Never open with "let's dive in", "have you ever wondered", "picture this",
  "in today's fast-paced", or "in the world of". Sound like the smartest trader in the room explaining something
  to a peer, not a brand account talking at a prospect.
- LENGTH: the script is 45-75 words, hard maximum 80 (about 18-30 seconds spoken). Short videos
  get watched to the end, and completion rate is the strongest TikTok ranking signal. Cut any
  sentence that doesn't earn its place; one idea, one payoff.
- LOOP ENDING: the final sentence must flow straight back into the hook, so the video replays
  seamlessly when it restarts -- rewatches are another strong ranking signal. Write the last line
  so it reads as the beginning of the hook's sentence or thought (e.g. hook "Your loss limit
  doesn't care that the trade was a good one" -> final line "...and that's exactly why" / "Because"),
  never a sign-off, never "thanks for watching", never a standalone conclusion. Mention
  Fillbook and fillbookhq.com once, naturally, in the middle-to-late body where it is relevant
  (never as the last line) -- the video ends on the loop, not on a brand card.
- Shot list: filmable with a phone + screen recorder + basic title cards. 8-12 entries -- one
  per script beat of roughly 2-3 seconds, because the visuals should change that often. Show
  Fillbook UI where it is genuinely relevant -- always labeled example/demo data.
- YouTube title: specific, under 70 characters, searchable -- no ALL CAPS, no stacked punctuation.
- YouTube description: 3-5 sentences. Expand the hook, name the specific problem Fillbook solves,
  close with a clear CTA pointing to fillbookhq.com. Distinct from the spoken script and the
  TikTok caption.
- TikTok caption: 2-3 lines, platform-native voice, punchy. Name the pain or insight in line 1,
  deliver the value angle in line 2, close with a soft CTA ("link in bio" or similar) in line 3.
  Distinct from both the spoken script and the YouTube description.
- Instagram caption: same punchy hook-first opening as the TikTok caption, but 3-5 lines --
  Instagram captions are read more (and indexed by Instagram's own search), so add one more real
  sentence of value/context after the hook before the CTA. Not a copy-paste of the TikTok caption;
  distinct wording, same underlying insight.
- Hashtags: 5-8 relevant tags, no stuffing, no irrelevant trending tags.
- YouTube thumbnail concept: one bold text overlay (under 6 words, readable at thumbnail size)
  plus one sentence describing the background visual. The thumbnail alone should make someone stop
  and wonder what the video says. Think contrast, specificity, genuine curiosity -- not shock.
- disclosureCta: a short disclosure or soft close when genuinely needed (e.g. crediting example
  data). Return null when it would just be filler.

GROUNDING RULES:
- Ground every factual claim about Fillbook ONLY in the "Verified knowledge" section you are given.
  Never invent a feature, stat, or capability that is not listed there.
- HARD RULE, auto-fails review every time: never write the script (or hook, or any other field) as
  a first-person trader telling their OWN trading story -- no "my funded account", "when I blew my
  account", "my drawdown", "I started journaling and", or any other framing that implies Fillbook or
  its creator personally trades or has personal results. This applies even when the opportunity topic
  is about routines, discipline, redemption, or "how I..." -- rewrite those as a general/observational
  or second-person ("you"/"traders who...") framing instead, e.g. "Traders who journal their setups
  catch this pattern in a week" NOT "I didn't catch this pattern until I'd blown two accounts."
  Fillbook is a product speaking about traders in general or to the viewer directly -- never a trader
  speaking about themselves.
- Any on-screen trading data must be clearly labeled example/demo data unless the opportunity's own
  evidence is explicitly real, consented user data.
- Never state an unverified quantitative or comparative claim as flat fact (e.g. "X causes more
  breaches than Y", "most traders do X", "traders who journal have a 63% lower breach rate", "90% of
  prop-firm breaches happen to traders who never kept a journal", "cut losing streaks 2x faster"). If
  the Verified knowledge section doesn't contain the exact number or comparison, do not state a
  number at all -- hedge it into a qualitative observation instead ("journaling makes this pattern
  easier to catch"), never a plausible-sounding invented statistic. This is the single most common
  real review failure across every video topic that touches journaling, review habits, or discipline
  -- treat any number in a draft hook as a bug unless you can point to exactly where in the Verified
  knowledge section it came from.

Submit your result via the submit_video_script tool.`;

/**
 * Generates a real, shootable production package (hook/script/shot
 * list/caption/hashtags) for one video, the same "invent once, review
 * downstream" shape as contentWriter.draftContent -- everything after
 * this (ContentQualityGate, the nine deep-review agents) reviews this
 * step's output rather than replacing the grounding it should already
 * have done.
 *
 * Deliberately does NOT render anything -- no TTS call, no ffmpeg, no
 * video file. Vercel's serverless functions have execution-time and
 * disk limits unsuited to video rendering (see docs/PROGRESS_LEDGER.md's
 * Video Factory entry); this stops at the script/shot-list/caption the
 * owner needs to actually shoot and render the video themselves, or feed
 * into a separate rendering environment later.
 */
export async function draftVideoScript(
  client: LlmClient,
  opportunity: { title: string; rationale: string },
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
  recentVideos: readonly RecentVideo[] = [],
): Promise<VideoScript> {
  const recentSection = formatRecentVideos(recentVideos);
  const userMessage = [
    `Opportunity: ${opportunity.title}`,
    `Rationale: ${opportunity.rationale}`,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (use ONLY these facts about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary,
    recentSection ? "" : null,
    recentSection || null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const call = (message: string) =>
    client.callTool<VideoScriptToolInput>(SYSTEM_PROMPT, message, "submit_video_script", VIDEO_SCRIPT_SCHEMA, 45_000, 4096);

  let result = await call(userMessage);
  let words = countSpokenWords(result.script);
  if (words > MAX_SCRIPT_WORDS) {
    // The length rule in the prompt is only a request -- a model can exceed
    // it (a 90+ word script renders as a ~31s video, past the ~25s target that
    // holds completion rate). Send it back once with the exact count.
    const retryMessage = [
      userMessage,
      "",
      `LENGTH FIX REQUIRED: your previous script was ${words} words. The hard maximum is ${MAX_SCRIPT_WORDS}; the target is 45-75.`,
      "Previous script:",
      result.script,
      "",
      "Rewrite the whole package with a shorter script: cut sentences, not the idea. Keep the hook and the loop ending (the last line flows back into the hook), and keep 8-12 shot-list beats that match the shorter script.",
    ].join("\n");
    result = await call(retryMessage);
    words = countSpokenWords(result.script);
    if (words > MAX_SCRIPT_WORDS) throw new VideoScriptTooLongError(words);
  }

  // The prompt asks for a fresh hook, but a model can still fall back on an opening it has
  // used before. Send a repeat back with the offending hook named, and give up (rather than
  // publish a repeat) if it still comes back the same.
  const recentHooks = recentVideos.map((video) => video.hook);
  for (let attempt = 1; ; attempt++) {
    const repeated = findRepeatedHook(result.hook, recentHooks);
    if (!repeated) return result;
    if (attempt > MAX_HOOK_REWRITES) throw new VideoHookRepeatError(result.hook, repeated);
    result = await call(
      [
        userMessage,
        "",
        "HOOK REPEATS A RECENT VIDEO -- REWRITE REQUIRED:",
        `Your hook: ${result.hook}`,
        `Recent hook it repeats: ${repeated}`,
        "Write the whole package again with a different opening, a different mechanic or consequence for this topic, and a loop ending that flows into the NEW hook. Keep the script within the length limit.",
      ].join("\n"),
    );
    words = countSpokenWords(result.script);
    if (words > MAX_SCRIPT_WORDS) throw new VideoScriptTooLongError(words);
  }
}

/** How many times a repeated hook is sent back before the request fails instead. */
export const MAX_HOOK_REWRITES = 2;

export class VideoHookRepeatError extends Error {
  constructor(
    public readonly hook: string,
    public readonly repeatedHook: string,
  ) {
    super(`Video hook still repeats a recent video after ${MAX_HOOK_REWRITES} rewrites ("${hook}" vs "${repeatedHook}"). Not queuing it -- try the request again or pick a different topic.`);
    this.name = "VideoHookRepeatError";
  }
}

/** Hard ceiling on spoken words (~27s at the render's +8% pace); the prompt asks for 45-75. */
export const MAX_SCRIPT_WORDS = 80;

export class VideoScriptTooLongError extends Error {
  constructor(public readonly words: number) {
    super(`Video script is ${words} words after one rewrite; the maximum is ${MAX_SCRIPT_WORDS}. Not queuing it -- a script this long renders past the target length.`);
    this.name = "VideoScriptTooLongError";
  }
}

/** Whitespace-separated tokens that contain a letter or digit (a stray "--" or "&" isn't a spoken word). */
export function countSpokenWords(script: string): number {
  return script.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/**
 * Flattens a VideoScript into one readable text block so it can flow
 * through the existing text-shaped pipeline unmodified -- ContentQualityGate,
 * the review agents, and content_versions.body all operate on a single
 * string, and nothing about that needs to change for video content. The
 * owner reads this same block in the Approvals screen to actually shoot
 * and render the video (see docs/VIDEO_FACTORY.md).
 */
export function formatVideoScriptAsText(video: VideoScript): string {
  const shots = video.shotList.map((shot, i) => `${i + 1}. ${shot}`).join("\n");
  const hashtags = video.hashtags.map((h) => `#${h}`).join(" ");
  return [
    `HOOK: ${video.hook}`,
    "",
    "SCRIPT:",
    video.script,
    "",
    "SHOT LIST:",
    shots,
    "",
    "YOUTUBE TITLE:",
    video.youtubeTitle,
    "",
    "YOUTUBE THUMBNAIL CONCEPT:",
    video.youtubeThumbnailConcept,
    "",
    "YOUTUBE DESCRIPTION:",
    video.youtubeDescription,
    "",
    "TIKTOK CAPTION:",
    video.tiktokCaption,
    "",
    "INSTAGRAM CAPTION:",
    video.instagramCaption,
    "",
    `HASHTAGS: ${hashtags}`,
    ...(video.disclosureCta ? ["", `DISCLOSURE/CTA: ${video.disclosureCta}`] : []),
  ].join("\n");
}
