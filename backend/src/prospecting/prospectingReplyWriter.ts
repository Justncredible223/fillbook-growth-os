import type { LlmClient } from "../content/llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    isRelevant: {
      type: "boolean",
      description:
        "True only if their post is genuinely about futures/markets trading, prop-firm trading, or trader psychology/discipline/journaling -- false if it only superficially matched the search (e.g. it's a story, meme, unrelated news, or uses a search word in a non-trading sense). Judge this FIRST, honestly, before writing anything.",
    },
    reply: {
      type: "string",
      description: "The exact reply text, ready to post as-is. Leave this an empty string when isRelevant is false -- it will never be shown or used.",
    },
    mentionsFillbook: { type: "boolean", description: "True only if the reply actually names Fillbook." },
    usesLink: { type: "boolean", description: "True only if the reply includes a Fillbook link placeholder." },
  },
  required: ["isRelevant", "reply", "mentionsFillbook", "usesLink"],
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
  /** Human name used in the prompt ("X"). */
  displayName: string;
  /** What we are replying to, in the platform's own vocabulary. */
  postNoun: string;
  /** The ONLY link the model may ever use on this platform. */
  trackableLink: string;
  /** Platform-specific shape/etiquette rules, appended to the shared prompt. */
  styleRules: string;
  /** Platform-specific link etiquette -- when (if ever) a link is acceptable and how it must be presented. */
  linkPolicy: string;
  /**
   * How aggressively (or not) a mention of Fillbook is ever appropriate --
   * genuinely different per platform, not just a style tweak. X's version
   * (2026-09-05 refresh) replaces a purely "almost never mention it"
   * default with a structure for when a mention is actually earned, per
   * owner direction that replies read as pure advice with no path to
   * awareness. Any other/unrecognized platform falls back to the original,
   * more conservative "90%+ no mention" rule verbatim.
   */
  noPitchGuidance: string;
}

/**
 * X-specific (2026-09-05): genuinely useful first, sounds human, and can
 * naturally create awareness of Fillbook when the conversation is
 * actually relevant -- a thoughtful trader/builder joining the
 * conversation, never a salesperson using advice as a pretext to pitch.
 * Replaces the old blanket "90%+ mention NOT AT ALL" default with a
 * structure for recognizing when a mention is earned, while keeping every
 * hard boundary (no link by default, no generic marketing phrases, no
 * unverified claims, no impersonation/concealment) at least as strict as
 * before.
 */
const X_REPLY_NO_PITCH_GUIDANCE = `Sound like a thoughtful trader or builder joining the conversation -- genuinely useful first, human,
and something that can naturally create awareness of Fillbook when the conversation is actually
relevant. Never a salesperson using advice as a pretext to pitch.

When the conversation is genuinely relevant to trade journaling, rule tracking, consistency,
drawdown discipline, or reviewing trades, use this shape where it fits -- skip steps that don't
apply; this is not a rigid template to fill in mechanically:
1. Respond specifically to what they actually said, not a generic reaction anyone could have posted.
2. Add one concrete insight, example, or a real practical question.
3. Only if it fits naturally, connect their problem to journaling/rule-tracking/consistency/drawdown
   discipline/reviewing trades -- never force this connection where it doesn't belong.
4. Only once steps 1-3 already made a real, earned connection to that problem, you MAY optionally
   note that Fillbook is built around it.
5. A soft invitation is fine when it's earned -- for example: "That's one of the things we're trying to make easier with Fillbook." Never a link, never a call to action, never "check it out."

Hard rules, no exceptions:
- Never add a Fillbook mention when it doesn't logically fit the conversation -- when genuinely
  unsure, leave it out; silence is always the safe default, not a missed opportunity.
- Never include a link by default -- see the link policy below for the rare exception.
- Never use generic marketing phrases or close variants of them: "check out our platform", "learn
  more", "DM me", "sign up today", "click here", "link in bio".
- Never claim a personal trading result, a customer/user result, or a product capability that isn't
  in the verified knowledge given to you.
- Never impersonate an individual trader or conceal that this is the Fillbook account replying --
  the VOICE sounds like a real person, but the affiliation is never hidden or denied.`;

/** The original, unchanged conservative guidance -- see this constant's own docstring above on why this stays conservative while X gets more structure. Used as the fallback for any platform other than X. */
const CONSERVATIVE_NO_PITCH_GUIDANCE = `90%+ of good replies here mention Fillbook NOT AT ALL. Your default assumption should be
mentionsFillbook=false and usesLink=false. Only set them true when the conversation is
SPECIFICALLY about trade journaling/tracking/analytics tools and a mention would feel earned, not
forced. Never write "we built Fillbook for this, check it out" or any variant -- that pattern is
explicitly banned. If you're unsure, leave Fillbook out entirely.

Before finalizing, apply this test: "Would this still be worth saying if Fillbook had nothing to
sell?" If the answer is no, the reply needs a genuine value component added, not a softer sales pitch.`;

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
    noPitchGuidance: X_REPLY_NO_PITCH_GUIDANCE,
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
    // An unrecognized platform gets the conservative default, not X's more
    // structured one -- an unknown platform should never accidentally
    // inherit X's more permissive mention guidance.
    noPitchGuidance: CONSERVATIVE_NO_PITCH_GUIDANCE,
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
 * acceptable) come from the profile above.
 */
export function buildProspectingSystemPrompt(profile: ProspectingPlatformProfile): string {
  return `You are considering ONE reply from the Fillbook account to someone else's ${profile.postNoun} on ${profile.displayName}. This
person did NOT mention or reply to us -- their post matched an automated search for a trading-related
topic, but that match can be imprecise (a search word used in an unrelated sense, a post that only
superficially resembles trading content, etc.). Fillbook is a trading journal/analytics platform for
futures day traders and prop-firm funded accounts.

FIRST, judge isRelevant honestly: is their post genuinely about futures/markets trading, prop-firm
trading, or trader psychology/discipline/journaling? If it is NOT -- e.g. it's a story, a meme, unrelated
news, or a generic self-help/life post that just happens to use a word like the search topic in a
different sense -- set isRelevant=false, leave reply as an empty string, and do not attempt to force a
connection to trading. A confident "this isn't relevant" is the correct, expected outcome for many
candidates; it is never a failure. Only if isRelevant is true, continue below.

${profile.noPitchGuidance}

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

Submit your result via the submit_reply tool, and set isRelevant/mentionsFillbook/usesLink accurately
based on your own honest judgment and what you actually wrote -- these are checked, not just
descriptive.`;
}

export interface ProspectingDraftContext {
  /** The candidate's platform as stored on the row ("x") -- selects the prompt profile. */
  platform: string;
  authorHandle: string | null;
  postText: string;
  discoveryQuery: string;
}

export interface ProspectingDraftResult {
  isRelevant: boolean;
  reply: string;
  mentionsFillbook: boolean;
  usesLink: boolean;
}

/**
 * Drafts exactly one reply for a human to review, edit, and post themselves
 * -- same no-send guarantee as inboundResponseWriter.ts (this module only
 * ever calls the LLM; ExternalWriteFirewall blocks any x.reply/x.post_tweet
 * write action class unconditionally as a second, independent guarantee).
 * The draft is returned to the caller, not auto-persisted -- the API
 * route decides whether/how to store it against the prospecting_candidates
 * row.
 *
 * A real, confirmed bug this also closes: the model previously had no way
 * to say "this doesn't actually fit" except by writing that admission
 * into the reply text itself (e.g. "this event isn't futures related"),
 * which then got shown to the owner as if it were a usable draft.
 * isRelevant is the model's own structured escape hatch -- the caller
 * (prospectingHandlers.ts's draftProspectingCandidateReply) checks it and
 * never persists/returns a draft when it's false. This is a SECOND,
 * independent layer behind prospectingRelevance.ts's mechanical
 * pre-filter (which runs before this function is ever called) -- content
 * that slips past the keyword-based filter can still be caught here.
 */
export async function draftProspectingReply(
  client: LlmClient,
  context: ProspectingDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<ProspectingDraftResult> {
  const profile = prospectingPlatformProfile(context.platform);
  const authorPrefix = "@";
  const userMessage = [
    `Platform: ${profile.displayName}`,
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
