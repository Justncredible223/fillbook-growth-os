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
      description: "YouTube Shorts description (3-5 sentences): expand the hook, name the specific problem and how Fillbook solves it, close with a clear call-to-action directing viewers to fillbookhq.com. Distinct from both the spoken script and the TikTok caption.",
    },
    tiktokCaption: {
      type: "string",
      description: "TikTok caption (2-3 punchy lines, platform-native tone): hook the scroll, name the pain or insight, close with a soft CTA (e.g. 'link in bio'). Distinct from both the spoken script and the YouTube description.",
    },
    hashtags: { type: "array", items: { type: "string" }, description: "Hashtags without the # prefix, usable on either platform." },
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
  required: ["hook", "script", "shotList", "youtubeTitle", "youtubeDescription", "tiktokCaption", "hashtags", "disclosureCta", "youtubeThumbnailConcept"],
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

Your videos run on TikTok and YouTube Shorts. The goal of every video is to drive traders to
fillbookhq.com to sign up -- but the method is earning that visit by being genuinely useful, not
by selling. A trader who learns something real from a Fillbook video trusts the brand and clicks.
A trader who gets a sales pitch scrolls past.

QUALITY BAR -- every output must clear this:
- Hook: must stop a mid-scroll in 1-2 seconds. Use a specific number, a named mistake, or an
  unexpected claim -- not a rhetorical question, not "here's the thing", not a vague promise.
  The best hooks feel like a secret a real trader would actually want to know.
- Script: the exact words someone speaks aloud or feeds to a TTS voice. Tight, punchy, real.
  No filler sentences. No corporate SaaS language. Never use these phrases (they will auto-fail
  review): "at the end of the day", "when it comes to", "game changer", "game-changer",
  "unlock your potential", "take it to the next level", "in this day and age",
  "it's important to note that", "don't miss out", "act now", "limited time", "last chance".
  Never open with "let's dive in", "have you ever wondered", "picture this",
  "in today's fast-paced", or "in the world of". Sound like the smartest trader in the room explaining something
  to a peer, not a brand account talking at a prospect. Close every script with a natural,
  non-pushy mention of Fillbook and fillbookhq.com.
- Shot list: filmable with a phone + screen recorder + basic title cards. One entry per script
  beat. Show Fillbook UI where it is genuinely relevant -- always labeled example/demo data.
- YouTube title: specific, under 70 characters, searchable -- no ALL CAPS, no stacked punctuation.
- YouTube description: 3-5 sentences. Expand the hook, name the specific problem Fillbook solves,
  close with a clear CTA pointing to fillbookhq.com. Distinct from the spoken script and the
  TikTok caption.
- TikTok caption: 2-3 lines, platform-native voice, punchy. Name the pain or insight in line 1,
  deliver the value angle in line 2, close with a soft CTA ("link in bio" or similar) in line 3.
  Distinct from both the spoken script and the YouTube description.
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
  breaches than Y", "most traders do X", "traders who journal have a 63% lower breach rate"). If the
  Verified knowledge section doesn't contain the exact number or comparison, do not state a number at
  all -- hedge it into a qualitative observation instead ("journaling makes this pattern easier to
  catch"), never a plausible-sounding invented statistic.

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
    45_000,
    4096,
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
    "YOUTUBE THUMBNAIL CONCEPT:",
    video.youtubeThumbnailConcept,
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
