import type { LlmClient } from "../content/llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The exact reply text, ready to post as-is." },
  },
  required: ["reply"],
};

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
}

const INBOUND_PLATFORM_PROFILES: Record<string, InboundPlatformProfile> = {
  x: {
    displayName: "X",
    engagementNoun: "replied to, mentioned, or quoted one of our posts on X",
    styleRules: "Do not over-explain. A real X reply is usually one or two sentences. No hashtags.",
    handlePrefix: "@",
  },
  reddit: {
    displayName: "Reddit",
    engagementNoun: "replied to one of our comments or mentioned us in a thread on Reddit",
    styleRules:
      "This is a Reddit comment reply: plain text, no hashtags, no @-handles, no emoji padding. Two to four " +
      "sentences is normal when the question deserves it; Reddit readers value substance over brevity and " +
      "downvote anything that reads like brand copy.",
    handlePrefix: "u/",
  },
};

function inboundPlatformProfile(platform: string): InboundPlatformProfile {
  return (
    INBOUND_PLATFORM_PROFILES[platform.toLowerCase()] ?? {
      displayName: platform,
      engagementNoun: `replied to or mentioned us on ${platform}`,
      styleRules: "Do not over-explain. Keep the reply short and specific to what they said.",
      handlePrefix: "@",
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

This is a real one-on-one reply on ${profile.displayName}, not a broadcast post:
- Sound like a person replying, not a brand announcing something.
- Add real value or a genuine reaction -- don't just restate what they said back at them.
- Preserve the actual conversation context you're given -- reply to what they specifically said.
- If they've engaged with us before (noted below), it's fine to acknowledge that lightly and
  naturally -- never in a canned "thanks for being a loyal follower!" way.
- ${profile.styleRules}
- Do NOT pitch Fillbook, mention pricing, or drop a link unless the conversation itself is
  specifically about trade journaling/tracking tools and a mention would feel earned, not forced --
  when genuinely unsure, leave it out.
- Ground any product claim ONLY in the verified knowledge given -- never invent a feature.

Submit your result via the submit_reply tool.`;
}

export interface InboundDraftContext {
  /** The engagement's platform as stored on the row ("x", "reddit") -- selects the prompt profile. */
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
 * classifies x.post_tweet/x.reply and every reddit.* write as
 * EXTERNAL_WRITE regardless). The draft lands in
 * inbound_engagements.draft_response and the row's status moves to
 * 'draft_ready' -- a status distinct from 'responded', which only a human
 * action ever sets. See docs/INBOUND_ENGAGEMENT.md.
 */
export async function draftInboundResponse(
  client: LlmClient,
  context: InboundDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<string> {
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

  const result = await client.callTool<{ reply: string }>(buildInboundSystemPrompt(context.platform), userMessage, "submit_reply", DRAFT_SCHEMA);
  return result.reply;
}
