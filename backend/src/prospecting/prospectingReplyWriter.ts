import type { LlmClient } from "../content/llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The exact reply text, ready to post as-is." },
    mentionsFillbook: { type: "boolean", description: "True only if the reply actually names Fillbook." },
    usesLink: { type: "boolean", description: "True only if the reply includes a Fillbook link placeholder." },
  },
  required: ["reply", "mentionsFillbook", "usesLink"],
};

/**
 * Everything about a reply that legitimately differs by platform: what
 * the thing we're replying to is called, how long/what shape a good
 * reply takes there, and the one trackable link that's allowed if a link
 * is ever earned. The no-pitch principle, voice, and fact-check
 * discipline below are platform-independent and come from
 * fillbookhq/docs/social/MASTER_SOCIAL_STRATEGY.md.
 */
export interface ProspectingPlatformProfile {
  /** Human name used in the prompt ("X", "Reddit"). */
  displayName: string;
  /** What we are replying to, in the platform's own vocabulary. */
  postNoun: string;
  /** The ONLY link the model may ever use on this platform. */
  trackableLink: string;
  /** Platform-specific shape/etiquette rules, appended to the shared prompt. */
  styleRules: string;
  /** Platform-specific link etiquette -- when (if ever) a link is acceptable and how it must be presented. */
  linkPolicy: string;
}

/**
 * Both platforms currently share one redirect (fillbookhq.com/go/
 * prospecting). A Reddit-specific redirect would let attribution split by
 * platform, but it has to exist on fillbookhq.com first -- inventing a
 * URL here would ship a dead link, so the same known-good one is used
 * until the owner creates a second redirect.
 */
export const PROSPECTING_TRACKABLE_LINK = "fillbookhq.com/go/prospecting";

export const PROSPECTING_PLATFORM_PROFILES: Record<string, ProspectingPlatformProfile> = {
  x: {
    displayName: "X",
    postNoun: "public X post",
    trackableLink: PROSPECTING_TRACKABLE_LINK,
    styleRules:
      "A real X reply is usually one or two sentences. No hashtags, no thread-length essays, no @-mentioning " +
      "other accounts to pull them in. It reads like a person typing a quick, sharp reply under someone's post.",
    linkPolicy:
      "If -- and only if -- a link genuinely belongs, use exactly this trackable link and no other: " +
      `${PROSPECTING_TRACKABLE_LINK}. Put it at the end of the reply, never as the reply's main point.`,
  },
  reddit: {
    displayName: "Reddit",
    postNoun: "public Reddit post (a thread in a trading subreddit)",
    trackableLink: PROSPECTING_TRACKABLE_LINK,
    styleRules:
      "This is a Reddit comment, not a tweet: plain text, no hashtags, no @-handles, no emoji padding. A useful " +
      "comment can run a short paragraph (two to five sentences) when the question deserves it -- Reddit rewards " +
      "substance and punishes anything that reads like marketing copy. Match the subreddit's register: explain " +
      "the mechanics, show the working, and be willing to say 'it depends on the firm' when that is the honest " +
      "answer. Never open with a compliment or restate their post back to them.",
    linkPolicy:
      "Most trading subreddits ban or heavily downvote self-promotion, and a brand account dropping a link reads " +
      "as spam even when the link is relevant. Default to usesLink=false. A link is acceptable ONLY when the " +
      "poster explicitly asked for a tool recommendation; when that is the case, name what the link is in plain " +
      "words, use exactly this trackable link and no other: " +
      `${PROSPECTING_TRACKABLE_LINK}, and keep the rest of the comment useful on its own without it.`,
  },
};

function genericProfile(platform: string): ProspectingPlatformProfile {
  return {
    displayName: platform,
    postNoun: `public ${platform} post`,
    trackableLink: PROSPECTING_TRACKABLE_LINK,
    styleRules: "Keep the reply short, plain, and specific to their post.",
    linkPolicy:
      "If -- and only if -- a link genuinely belongs, use exactly this trackable link and no other: " +
      `${PROSPECTING_TRACKABLE_LINK}.`,
  };
}

/** Case-insensitive lookup with a conservative generic fallback -- an unknown platform never crashes drafting, but also never gets X-specific language by accident. */
export function prospectingPlatformProfile(platform: string): ProspectingPlatformProfile {
  return PROSPECTING_PLATFORM_PROFILES[platform.toLowerCase()] ?? genericProfile(platform);
}

/**
 * Cold-outreach reply drafting -- distinct from inboundResponseWriter.ts,
 * which is written for "someone replied TO us." This is for joining a
 * stranger's unrelated public post, so the framing, defaults, and quality
 * bar are different: no relationship context to lean on, and the default
 * is to add value with NO Fillbook mention at all.
 *
 * Every rule below is transcribed from fillbookhq/docs/social/
 * MASTER_SOCIAL_STRATEGY.md (the "No-pitch principle & reply quality" and
 * "Fillbook voice" sections) rather than invented here -- that's the
 * standing, human-authored growth policy this feature implements. The
 * platform-specific parts (what a reply looks like, when a link is ever
 * acceptable) come from the profile above so a Reddit candidate never
 * receives X framing or vice versa.
 */
export function buildProspectingSystemPrompt(profile: ProspectingPlatformProfile): string {
  return `You are drafting ONE reply from the Fillbook account to someone else's ${profile.postNoun} on ${profile.displayName}. This
person did NOT mention or reply to us -- we are joining their conversation because the topic is
genuinely relevant to futures/prop-firm trading. Fillbook is a trading journal/analytics platform for
futures day traders and prop-firm funded accounts.

THE RULE THAT MATTERS MOST: 90%+ of good replies here mention Fillbook NOT AT ALL. Your default
assumption should be mentionsFillbook=false and usesLink=false. Only set them true when the
conversation is SPECIFICALLY about trade journaling/tracking/analytics tools and a mention would feel
earned, not forced. Never write "we built Fillbook for this, check it out" or any variant -- that
pattern is explicitly banned. If you're unsure, leave Fillbook out entirely.

Link policy for ${profile.displayName}: ${profile.linkPolicy}

A good reply does ONE of: answers their question, explains a rule (drawdown/consistency/payout
mechanics), clarifies a misconception, gives a useful number or calculation, shares a practical
trading-journal or trade-review insight, offers a genuine observation, empathizes without sounding
fake, or asks a real follow-up question. Never engagement-bait ("Great post!", "Facts.", "100%",
"This."). Conversation beats performing expertise -- sometimes the best reply is a sharp question, not
a confident answer.

Voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful. No
corporate SaaS language, no excessive em dashes, no generic motivation, no AI clichés, no forced
controversy. Fillbook is a product/company and must never speak or be shown as if it personally
trades -- no "I" statements about trades, no fabricated personal trading history.

Shape for ${profile.displayName}: ${profile.styleRules}

Fact-check discipline: classify any factual claim you're relying on internally as VERIFIED FACT,
EVIDENCE-SUPPORTED OBSERVATION, REASONABLE HYPOTHESIS, or OPINION -- never state a hypothesis or
opinion as if it were a verified fact. Ground any Fillbook product claim ONLY in the verified knowledge
given below -- never invent a feature.

Before finalizing, apply this test: "Would this still be worth saying if Fillbook had nothing to
sell?" If the answer is no, the reply needs a genuine value component added, not a softer sales pitch.

Submit your result via the submit_reply tool, and set mentionsFillbook/usesLink accurately based on
what you actually wrote -- these are checked, not just descriptive.`;
}

export interface ProspectingDraftContext {
  /** The candidate's platform as stored on the row ("x", "reddit") -- selects the prompt profile. */
  platform: string;
  authorHandle: string | null;
  postText: string;
  discoveryQuery: string;
  /** Where the post lives, when the platform has such a thing (e.g. "r/FuturesTrading"). Null for X. */
  communityLabel?: string | null;
}

export interface ProspectingDraftResult {
  reply: string;
  mentionsFillbook: boolean;
  usesLink: boolean;
}

/**
 * Drafts exactly one reply for a human to review, edit, and post themselves
 * -- same no-send guarantee as inboundResponseWriter.ts (this module only
 * ever calls the LLM; ExternalWriteFirewall blocks any x.reply/x.post_tweet
 * or reddit.* write action class unconditionally as a second, independent
 * guarantee). The draft is returned to the caller, not auto-persisted --
 * the API route decides whether/how to store it against the
 * prospecting_candidates row.
 */
export async function draftProspectingReply(
  client: LlmClient,
  context: ProspectingDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<ProspectingDraftResult> {
  const profile = prospectingPlatformProfile(context.platform);
  const authorPrefix = profile.displayName === "Reddit" ? "u/" : "@";
  const userMessage = [
    `Platform: ${profile.displayName}${context.communityLabel ? ` (${context.communityLabel})` : ""}`,
    `From: ${authorPrefix}${context.authorHandle ?? "unknown"}`,
    `Why this post surfaced: matched the "${context.discoveryQuery}" topic.`,
    "",
    "Their post:",
    context.postText,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (use ONLY these facts about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary,
  ].join("\n");

  return client.callTool<ProspectingDraftResult>(buildProspectingSystemPrompt(profile), userMessage, "submit_reply", DRAFT_SCHEMA);
}
