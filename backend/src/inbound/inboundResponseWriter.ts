import type { LlmClient } from "../content/llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "The exact reply text, ready to post as-is." },
  },
  required: ["reply"],
};

const SYSTEM_PROMPT = `You are drafting ONE reply from @FillbookHQ to a specific person who replied to,
mentioned, or quoted one of our posts on X. Fillbook is a trading journal for futures day traders and
prop-firm funded accounts.

Voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful. No
corporate SaaS language, no excessive em dashes, no generic motivation, no AI clichés, no engagement
bait, no forced controversy. Never speak or be shown as if Fillbook personally trades.

This is a real one-on-one reply, not a broadcast post:
- Sound like a person replying, not a brand announcing something.
- Add real value or a genuine reaction -- don't just restate what they said back at them.
- Preserve the actual conversation context you're given -- reply to what they specifically said.
- If they've engaged with us before (noted below), it's fine to acknowledge that lightly and
  naturally -- never in a canned "thanks for being a loyal follower!" way.
- Do not over-explain. A real reply is usually one or two sentences.
- Do NOT pitch Fillbook, mention pricing, or drop a link unless the conversation itself is
  specifically about trade journaling/tracking tools and a mention would feel earned, not forced --
  when genuinely unsure, leave it out.
- Ground any product claim ONLY in the verified knowledge given -- never invent a feature.

Submit your result via the submit_reply tool.`;

export interface InboundDraftContext {
  authorHandle: string | null;
  messageText: string;
  inResponseToText: string | null;
  isRepeatEngager: boolean;
  priorInteractionCount: number;
}

/**
 * Drafts exactly one reply for a human to review and send themselves --
 * this module has no send capability and never will (ExternalWriteFirewall
 * classifies x.post_tweet/x.reply as EXTERNAL_WRITE regardless). The
 * draft lands in inbound_engagements.draft_response and the row's status
 * moves to 'draft_ready' -- a status distinct from 'responded', which
 * only a human action ever sets. See docs/INBOUND_ENGAGEMENT.md.
 */
export async function draftInboundResponse(
  client: LlmClient,
  context: InboundDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<string> {
  const relationshipNote = context.isRepeatEngager
    ? `This person has engaged with @FillbookHQ ${context.priorInteractionCount} time(s) before -- an existing relationship, not a stranger.`
    : "No prior recorded engagement from this person.";

  const userMessage = [
    `From: @${context.authorHandle ?? "unknown"}`,
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

  const result = await client.callTool<{ reply: string }>(SYSTEM_PROMPT, userMessage, "submit_reply", DRAFT_SCHEMA);
  return result.reply;
}
