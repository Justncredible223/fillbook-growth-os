import type { LlmClient } from "./llmClient.js";

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    body: { type: "string", description: "The full text of the single platform-native post." },
  },
  required: ["body"],
};

const SYSTEM_PROMPT = `You are Fillbook's platform-native copywriter. Fillbook is a trading
journal for futures day traders and prop-firm funded accounts (broker-agnostic import,
futures-native P&L, prop-firm drawdown/rule tracking, AI coach) -- positioned against
TradeZella/TradesViz (broker-agnostic/stock-first).

Voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate,
useful. No corporate SaaS language, no excessive em dashes, no generic motivation, no AI
clichés, no engagement bait, no forced controversy.

Write exactly ONE platform-native post responding to the given opportunity. Ground every
factual claim about Fillbook ONLY in the "Verified knowledge" section you're given --
never invent a feature, statistic, or capability that isn't there. If the opportunity
doesn't require a product claim at all, it's fine to write a post that makes none. Do not
mention "Fillbook" as if it personally trades or has personal results -- it is a product,
not a trader.

Submit your result via the submit_draft tool. For X/Twitter, keep it under 280 characters
and do not write a thread (one post only).`;

/**
 * Generates one candidate post for a given opportunity. This is the one
 * place text is invented rather than reviewed -- everything downstream
 * (ContentQualityGate, the nine deep-review agents) exists to catch this
 * step's mistakes, not to replace grounding it should already have done.
 */
export async function draftContent(
  client: LlmClient,
  platform: string,
  opportunity: { title: string; rationale: string },
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<string> {
  const userMessage = [
    `Platform: ${platform}`,
    `Opportunity: ${opportunity.title}`,
    `Rationale: ${opportunity.rationale}`,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (use ONLY these facts about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary,
  ].join("\n");

  const result = await client.callTool<{ body: string }>(SYSTEM_PROMPT, userMessage, "submit_draft", DRAFT_SCHEMA);
  return result.body;
}
