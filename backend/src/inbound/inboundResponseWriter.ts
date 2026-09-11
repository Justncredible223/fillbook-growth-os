import type { LlmClient } from "../content/llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The exact reply text, ready to post as-is." },
    usesLink: {
      type: "boolean",
      description:
        "True only if the reply includes the approved Fillbook contact link given in the link policy below, and only because the person's own message clearly asked for contact info or a link.",
    },
  },
  required: ["reply", "usesLink"],
};

/**
 * The one link Inbound is ever allowed to hand out, mirroring
 * prospectingReplyWriter.ts's PROSPECTING_TRACKABLE_LINK pattern -- a
 * single hardcoded, trackable link, never left to the model to invent.
 * Its own path (/go/contact) keeps it distinguishable from Prospecting's
 * outreach link in analytics. checkReplyGuardrails' domain check (see
 * xReplyGuardrails.ts) enforces this mechanically -- a model claiming
 * usesLink=true while actually writing some other domain still gets
 * rejected.
 */
export const INBOUND_TRACKABLE_LINK = "fillbookhq.com/go/contact";
export const INBOUND_APPROVED_LINK_DOMAINS = ["fillbookhq.com"];

/**
 * What differs between platforms for an inbound reply: how the person
 * reached us and what a reply looks like there. Everything else (voice,
 * no-pitch rule, grounding) is shared.
 */
interface InboundPlatformProfile {
  displayName: string;
  /** How they engaged, in the platform's own vocabulary. */
  engagementNoun: string;
  /** Platform-specific shape guidance. */
  styleRules: string;
  /** Handle prefix for the "From:" line. */
  handlePrefix: string;
  /** How aggressively (or not) a Fillbook mention is ever appropriate -- see the same-named field/rationale in prospectingReplyWriter.ts. X gets the 2026-09-05 structured refresh; any other platform falls back to the conservative default. */
  noPitchGuidance: string;
}

/**
 * Shared across every Inbound platform profile (unlike Prospecting, which
 * varies its link policy per platform) -- Inbound's link is never earned
 * by the conversation's topic, only by an explicit ask for contact info,
 * so the rule doesn't actually change per platform.
 */
const INBOUND_LINK_POLICY =
  `Do NOT include a link by default. Only if -- and only if -- this specific person's message clearly asks how to ` +
  `contact/reach/find Fillbook, or explicitly asks for a link or website, you may include exactly this link once, ` +
  `at the end of the reply, and set usesLink=true: ${INBOUND_TRACKABLE_LINK}. Never use any other link or domain. ` +
  `If they didn't clearly ask for contact info or a link, set usesLink=false and do not include a link at all, ` +
  `even if it feels helpful.`;

/**
 * X-specific (2026-09-05): a mention is earned only after the reply has
 * already added real value and made a genuine connection to journaling/
 * rule-tracking/consistency/drawdown/trade-review -- never a pretext.
 * Mirrors prospectingReplyWriter.ts's X_REPLY_NO_PITCH_GUIDANCE; kept as
 * its own copy here (not imported) since inbound's reply has no
 * mentionsFillbook/usesLink flags to check against and the two callers
 * shouldn't be coupled just to save a few lines.
 */
const X_INBOUND_NO_PITCH_GUIDANCE =
  "Do NOT pitch Fillbook, mention pricing, or drop a link by default. A mention is only earned once the reply " +
  "has already added a concrete insight and made a genuine connection to journaling/rule-tracking/consistency/" +
  "drawdown discipline/reviewing trades -- never as a pretext for advice. When it's earned, a soft, specific " +
  "invitation is fine (e.g. \"That's one of the things we're trying to make easier with Fillbook\") -- never a " +
  "link, never \"check it out\", never a call to action. Never use generic marketing phrases (\"check out our " +
  "platform\", \"learn more\", \"DM me\"). Never claim a personal trading result, a customer result, or a " +
  "capability that isn't in the verified knowledge given. Never conceal that this is the Fillbook account " +
  "replying. When genuinely unsure whether a mention fits, leave it out.";

const CONSERVATIVE_INBOUND_NO_PITCH_GUIDANCE =
  "Do NOT pitch Fillbook, mention pricing, or drop a link unless the conversation itself is " +
  "specifically about trade journaling/tracking tools and a mention would feel earned, not forced -- " +
  "when genuinely unsure, leave it out.";

const INBOUND_PLATFORM_PROFILES: Record<string, InboundPlatformProfile> = {
  x: {
    displayName: "X",
    engagementNoun: "replied to, mentioned, or quoted one of our posts on X",
    styleRules: "Do not over-explain. A real X reply is usually one or two sentences. No hashtags.",
    handlePrefix: "@",
    noPitchGuidance: X_INBOUND_NO_PITCH_GUIDANCE,
  },
};

function inboundPlatformProfile(platform: string): InboundPlatformProfile {
  return (
    INBOUND_PLATFORM_PROFILES[platform.toLowerCase()] ?? {
      displayName: platform,
      engagementNoun: `replied to or mentioned us on ${platform}`,
      styleRules: "Do not over-explain. Keep the reply short and specific to what they said.",
      handlePrefix: "@",
      // Unknown platform -- conservative default, same reasoning as
      // prospectingReplyWriter.ts's genericProfile().
      noPitchGuidance: CONSERVATIVE_INBOUND_NO_PITCH_GUIDANCE,
    }
  );
}

export function buildInboundSystemPrompt(platform: string): string {
  const profile = inboundPlatformProfile(platform);
  return `You are drafting ONE reply from the Fillbook account to a specific person who ${profile.engagementNoun}.
Fillbook is a trading journal for futures day traders and prop-firm funded accounts.

Voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful. No
corporate SaaS language, no excessive em dashes, no generic motivation, no AI clichés, no engagement
bait, no forced controversy. Never speak or be shown as if Fillbook personally trades.

Engagement bait specifically means: a closing line whose only job is soliciting another reply
("let's keep the conversation going", "would love to hear more", "what are your thoughts"),
rather than actually responding to what they said. If their message is short and low-content (e.g.
just agreeing with something), a short, specific reply that adds nothing new is better than padding
it out with a generic invitation to keep talking -- silence on a closer is fine.

This is a real one-on-one reply on ${profile.displayName}, not a broadcast post:
- Sound like a person replying, not a brand announcing something.
- Add real value or a genuine reaction -- don't just restate what they said back at them.
- Preserve the actual conversation context you're given -- reply to what they specifically said.
- If they've engaged with us before (noted below), it's fine to acknowledge that lightly and
  naturally -- never in a canned "thanks for being a loyal follower!" way.
- ${profile.styleRules}
- ${profile.noPitchGuidance}
- Ground any product claim ONLY in the verified knowledge given -- never invent a feature.

Link policy: ${INBOUND_LINK_POLICY}

Example of an earned mention done well (owner-written, 2026-09-10 -- this is the bar to aim for, not
boilerplate to imitate word-for-word):
  Fillbook's own post: "Usually because they never write down what actually went wrong -- hard to
  improve what you don't measure."
  Their reply: "Exactly you got it"
  Good response: "Appreciate you -- Fillbook will always be here for those who finally reach that
  point of accepting everything needs to be logged, reviewed and assessed with their trades. It will
  show them the bad habits they have and what they need to do next to fix them and get that payout!"
  Why this works: the reply doesn't just thank them and stop -- it lands the Fillbook mention as the
  direct payoff of the specific point already being discussed (log it -> see the bad habits -> fix
  them -> keep the funded account), so the mention reads as the natural conclusion of the thread, not
  a pitch bolted onto a generic "thanks!". No closer soliciting another reply was needed; the content
  itself did the work.

Submit your result via the submit_reply tool, and set usesLink accurately based on what you actually
wrote -- it is checked, not just descriptive.`;
}

export interface InboundDraftContext {
  /** The engagement's platform as stored on the row ("x") -- selects the prompt profile. */
  platform: string;
  authorHandle: string | null;
  messageText: string;
  inResponseToText: string | null;
  isRepeatEngager: boolean;
  priorInteractionCount: number;
}

/**
 * Drafts exactly one reply for a human to review and send themselves --
 * this module has no send capability and never will (ExternalWriteFirewall
 * classifies x.post_tweet/x.reply as EXTERNAL_WRITE regardless). The draft lands in
 * inbound_engagements.draft_response and the row's status moves to
 * 'draft_ready' -- a status distinct from 'responded', which only a human
 * action ever sets. See docs/INBOUND_ENGAGEMENT.md.
 */
export interface InboundDraftResult {
  reply: string;
  usesLink: boolean;
}

export async function draftInboundResponse(
  client: LlmClient,
  context: InboundDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<InboundDraftResult> {
  const profile = inboundPlatformProfile(context.platform);
  const relationshipNote = context.isRepeatEngager
    ? `This person has engaged with Fillbook on ${profile.displayName} ${context.priorInteractionCount} time(s) before -- an existing relationship, not a stranger.`
    : "No prior recorded engagement from this person.";

  const userMessage = [
    `Platform: ${profile.displayName}`,
    `From: ${profile.handlePrefix}${context.authorHandle ?? "unknown"}`,
    relationshipNote,
    "",
    context.inResponseToText ? `What they were replying to: ${context.inResponseToText}` : "(Standalone mention/reply -- no parent post text available.)",
    "",
    "Their message:",
    context.messageText,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (use ONLY these facts about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary,
  ].join("\n");

  return client.callTool<InboundDraftResult>(buildInboundSystemPrompt(context.platform), userMessage, "submit_reply", DRAFT_SCHEMA);
}
