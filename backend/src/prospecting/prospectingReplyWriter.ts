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
 * Cold-outreach reply drafting -- distinct from inboundResponseWriter.ts,
 * which is written for "someone replied TO us." This is for joining a
 * stranger's unrelated public post, so the framing, defaults, and quality
 * bar are different: no relationship context to lean on, and the default
 * is to add value with NO Fillbook mention at all.
 *
 * Every rule below is transcribed from fillbookhq/docs/social/
 * MASTER_SOCIAL_STRATEGY.md (the "No-pitch principle & reply quality" and
 * "Fillbook voice" sections) rather than invented here -- that's the
 * standing, human-authored growth policy this feature implements.
 */
const SYSTEM_PROMPT = `You are drafting ONE reply from @FillbookHQ to someone else's public X post. This
person did NOT mention or reply to us -- we are joining their conversation because the topic is
genuinely relevant to futures/prop-firm trading. Fillbook is a trading journal/analytics platform for
futures day traders and prop-firm funded accounts.

THE RULE THAT MATTERS MOST: 90%+ of good replies here mention Fillbook NOT AT ALL. Your default
assumption should be mentionsFillbook=false and usesLink=false. Only set them true when the
conversation is SPECIFICALLY about trade journaling/tracking/analytics tools and a mention would feel
earned, not forced. Never write "we built Fillbook for this, check it out" or any variant -- that
pattern is explicitly banned. If you're unsure, leave Fillbook out entirely. If -- and only if -- a
link genuinely belongs, use exactly this trackable link and no other: fillbookhq.com/go/prospecting

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

Fact-check discipline: classify any factual claim you're relying on internally as VERIFIED FACT,
EVIDENCE-SUPPORTED OBSERVATION, REASONABLE HYPOTHESIS, or OPINION -- never state a hypothesis or
opinion as if it were a verified fact. Ground any Fillbook product claim ONLY in the verified knowledge
given below -- never invent a feature.

Before finalizing, apply this test: "Would this still be worth saying if Fillbook had nothing to
sell?" If the answer is no, the reply needs a genuine value component added, not a softer sales pitch.

A real reply is usually one or two sentences. Submit your result via the submit_reply tool, and set
mentionsFillbook/usesLink accurately based on what you actually wrote -- these are checked, not just
descriptive.`;

export interface ProspectingDraftContext {
  authorHandle: string | null;
  postText: string;
  discoveryQuery: string;
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
 * action class unconditionally as a second, independent guarantee). The
 * draft is returned to the caller, not auto-persisted -- the API route
 * decides whether/how to store it against the prospecting_candidates row.
 */
export async function draftProspectingReply(
  client: LlmClient,
  context: ProspectingDraftContext,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<ProspectingDraftResult> {
  const userMessage = [
    `From: @${context.authorHandle ?? "unknown"}`,
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

  return client.callTool<ProspectingDraftResult>(SYSTEM_PROMPT, userMessage, "submit_reply", DRAFT_SCHEMA);
}
