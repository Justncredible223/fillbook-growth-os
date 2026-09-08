import type { LlmClient } from "./llmClient.js";

const VIDEO_SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    hook: { type: "string", description: "The opening line, spoken or on-screen, in the first 1-2 seconds." },
    script: { type: "string", description: "Full voiceover/spoken script, hook through close. Plain sentences, no stage directions." },
    shotList: {
      type: "array",
      items: { type: "string" },
      description: "Ordered visual beats (what's on screen for each script segment) -- e.g. 'Text card: the number', 'Fillbook UI: the trade log filtering by date'.",
    },
    youtubeTitle: {
      type: "string",
      description: "YouTube Shorts video title -- under ~70 characters, specific, no clickbait/all-caps/excessive punctuation.",
    },
    youtubeDescription: {
      type: "string",
      description: "YouTube Shorts description text -- a few sentences expanding on the hook, separate from the spoken script.",
    },
    tiktokCaption: {
      type: "string",
      description: "TikTok caption text -- short, platform-native tone, separate from the spoken script and from the YouTube description.",
    },
    hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without the # prefix, usable on either platform." },
    disclosureCta: {
      type: ["string", "null"],
      description:
        "An optional short disclosure or call-to-action line (e.g. crediting example/demo data, or a soft 'link in bio' style close) -- null when the video genuinely doesn't need one, never fabricated to fill the field.",
    },
  },
  required: ["hook", "script", "shotList", "youtubeTitle", "youtubeDescription", "tiktokCaption", "hashtags", "disclosureCta"],
};

interface VideoScriptToolInput {
  hook: string;
  script: string;
  shotList: string[];
  youtubeTitle: string;
  youtubeDescription: string;
  tiktokCaption: string;
  hashtags: string[];
  disclosureCta: string | null;
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
  hashtags: string[];
  /** Null when genuinely not needed -- never a fabricated filler line. */
  disclosureCta: string | null;
}

const SYSTEM_PROMPT = `You are Fillbook's short-form video writer (TikTok, Reels, YouTube Shorts). Fillbook is a
trading journal for futures day traders and prop-firm funded accounts (broker-agnostic import,
futures-native P&L, prop-firm drawdown/rule tracking, AI coach) -- positioned against
TradeZella/TradesViz (broker-agnostic/stock-first).

Voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful. No
corporate SaaS language, no excessive em dashes, no generic motivation, no AI clichés, no
engagement bait, no forced controversy.

Write a real, shootable production package for ONE video responding to the given opportunity:
- hook: the exact opening line (spoken or on-screen text) -- must stop a scroll in the first 1-2
  seconds. Specific, creates a real information gap, or names a concrete mistake/number. Not a
  generic opener ("Here's the thing about...", a rhetorical question with an obvious answer).
- script: the full spoken voiceover, hook through close, as plain sentences an owner can actually
  read aloud or feed to a TTS voice. Not a treatment or outline -- the actual words.
- shotList: one entry per script beat describing what's on screen -- text cards, Fillbook UI
  screens (grounded ONLY in the verified knowledge below, labeled example/demo data), or plain
  talking-to-camera. Keep it filmable with a phone/screen-recorder + basic title cards, not a
  production nobody can actually shoot alone.
- youtubeTitle: a real YouTube Shorts video title, under ~70 characters, specific -- not clickbait,
  not ALL CAPS, not stacked punctuation.
- youtubeDescription: the YouTube Shorts description, a few sentences expanding on the hook --
  distinct from both the spoken script and the TikTok caption, never identical to either.
- tiktokCaption: the TikTok caption, short and platform-native in tone -- distinct from both the
  spoken script and the YouTube description, never identical to either.
- hashtags: relevant, not spammy -- no hashtag stuffing, no irrelevant trending tags. Usable on
  either platform.
- disclosureCta: an optional short disclosure or call-to-action line (e.g. crediting example/demo
  data, or a soft close). Return null when the video genuinely doesn't need one -- never invent a
  filler line just to fill this field.

Ground every factual claim about Fillbook ONLY in the "Verified knowledge" section you're given --
never invent a feature, statistic, or capability that isn't there. Do not show or describe Fillbook
as if it personally trades or has personal results -- it is a product, not a trader. Any on-screen
trading data must be clearly labeled example/demo data unless the opportunity's own evidence is
real, consenting-user data.

Never state an unverified quantitative or comparative claim as flat fact -- e.g. "X causes more
breaches than Y", "most traders do X". Nobody has that data. Hedge it explicitly or drop the
comparison for a narrower, defensible observation.

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
): Promise<VideoScript> {
  const userMessage = [
    `Opportunity: ${opportunity.title}`,
    `Rationale: ${opportunity.rationale}`,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (use ONLY these facts about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary,
  ].join("\n");

  const result = await client.callTool<VideoScriptToolInput>(
    SYSTEM_PROMPT,
    userMessage,
    "submit_video_script",
    VIDEO_SCRIPT_SCHEMA,
  );
  return result;
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
    "YOUTUBE DESCRIPTION:",
    video.youtubeDescription,
    "",
    "TIKTOK CAPTION:",
    video.tiktokCaption,
    "",
    `HASHTAGS: ${hashtags}`,
    ...(video.disclosureCta ? ["", `DISCLOSURE/CTA: ${video.disclosureCta}`] : []),
  ].join("\n");
}
