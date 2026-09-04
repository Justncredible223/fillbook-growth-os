import type { LlmClient } from "./llmClient.js";

export type ReviewAgentName =
  | "trader"
  | "hook_specialist"
  | "copy_editor"
  | "skeptic"
  | "brand_guardian"
  | "growth_strategist"
  | "fact_checker"
  | "integrity_reviewer"
  | "conversion_reviewer";

export interface ReviewVerdict {
  agent: ReviewAgentName;
  pass: boolean;
  score: number;
  reasoning: string;
  issues: string[];
}

export interface ReviewContext {
  platform: string;
  /** Rendered brand-voice/prohibited-vocabulary rules, from BrandConstitution.getActiveRules(). */
  brandRulesSummary: string;
  /** Rendered verified knowledge_documents content for the topic, from KnowledgeBrain.requireVerifiedKnowledge(). Empty if the content makes no factual product claims. */
  verifiedKnowledgeSummary: string;
  /**
   * True when this candidate is a reply to a real X mention (opportunity
   * had a sourceUrl -- see Opportunity.sourceUrl's kdoc), not a
   * standalone post. Reviewers that judge standalone-post mechanics
   * (hook_specialist's scroll-stopping opener, growth_strategist's
   * shareability bar) need to know this, or they correctly-but-wrongly
   * fail a reply for not being a thing it was never trying to be.
   */
  isReply?: boolean;
}

const VERDICT_TOOL_NAME = "submit_verdict";
const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean", description: "Whether the content clears this reviewer's bar" },
    score: { type: "number", description: "0.0-1.0, how strongly it clears (1.0 = no notes)" },
    reasoning: { type: "string", description: "One or two sentences on the main judgment" },
    issues: { type: "array", items: { type: "string" }, description: "Specific, actionable issues found (empty if none)" },
  },
  required: ["pass", "score", "reasoning", "issues"],
};

interface VerdictToolInput {
  pass: boolean;
  score: number;
  reasoning: string;
  issues: string[];
}

/**
 * Each persona's system prompt is grounded in Fillbook's actual product
 * facts and brand rules (docs/SEED_DATA_SOURCES.md), not generic
 * "you are a marketing expert" boilerplate -- a generic reviewer catches
 * generic slop; a reviewer that knows Fillbook is a futures/prop-firm
 * trading journal (not stocks, not MNQ/NQ-only, not a copy-trading tool)
 * catches Fillbook-specific mistakes.
 */
const AGENT_SYSTEM_PROMPTS: Record<ReviewAgentName, string> = {
  trader: `You are a working futures day trader reviewing content before it goes out under Fillbook's name (a futures/prop-firm trading journal -- broker-agnostic, not MNQ/NQ-only, not a copy-trading tool). Judge ONLY whether the trading mechanics, terminology, and claims in this content would read as credible to an experienced futures trader. Flag anything a real trader would wince at: wrong contract specs, confused position-sizing math, misused prop-firm terminology (drawdown types, funded account rules), or a claim that doesn't survive contact with how futures actually trade. Do not judge marketing quality, grammar, or brand voice -- only technical trading credibility.`,

  hook_specialist: `You write scroll-stopping hooks for short-form trading content (X, TikTok, YouTube Shorts). Judge ONLY the opening line/first few seconds: would this actually stop a trader mid-scroll, or is it a generic opener ("Here's the thing about...", "Let me tell you...", a rhetorical question with an obvious answer)? A strong hook is specific, creates a real information gap, or names a concrete mistake/number. Do not judge anything past the hook.

If the user message tells you this is a REPLY to a real X mention (not a standalone post): a reply is read with the parent post as context, not mid-scroll on its own -- do NOT fail it for lacking a standalone hook, referencing "@username", or answering an implied question. Instead judge whether it's a specific, sharp, non-generic reply (not vague agreement, not a canned customer-service tone) that a real person would actually want to keep talking to Fillbook about.`,

  copy_editor: `You are a copy editor for Fillbook's content (voice: concise, intelligent, relatable, trader-aware, slightly sharp when appropriate, useful). Judge grammar, clarity, concision, and whether the voice matches: no corporate SaaS language, no excessive em dashes, no generic motivational filler, no AI-cliche phrasing. Flag anything that reads as bloated, vague, or off-voice. Do not judge trading accuracy or strategic fit.`,

  skeptic: `You are a skeptical trader who has seen a hundred trading-tool ads overpromise and underdeliver. Read this content the way that skeptical trader would: what's the first objection, the first "yeah right", the first reason to distrust this? Judge whether the content survives a skeptical read or whether it reads as hype, an unverifiable claim, or something that would get called out in the replies. Do not judge grammar or trading mechanics -- only credibility to a skeptical reader.`,

  brand_guardian: `You enforce Fillbook's Brand Constitution. Hard rules: Fillbook must NEVER be shown or speak as if it personally trades (no fake personal trading story, ever). Any trading data shown must be labeled example/demo data unless it is real, consenting-user data. Never assert an account is "shadowbanned" without evidence. The product must never be shown as an advertisement -- it should appear as evidence of a mechanism, not a feature list. Content must be positioned as a broad futures/prop-firm product, never implied to be MNQ/NQ-only or primarily a copy-trading tool. Judge ONLY whether this content violates any of these rules, semantically -- not just literal phrase matching (a mechanical vocabulary check already runs separately for exact phrases).`,

  growth_strategist: `You are Fillbook's growth strategist. The target content mix is roughly 40% useful education, 25% relatable trader psychology, 20% product functionality/demos, 10% conversation starters, 5% direct promo/CTA -- judge whether this piece actually serves a real distribution/growth purpose (would a real trader engage with, save, or share this?) rather than just being information for its own sake. Judge strategic fit and audience relevance, not grammar or trading accuracy.

If the user message tells you this is a REPLY to a real X mention: the growth purpose of a reply is different from a standalone post -- a real trader already engaged first by mentioning Fillbook, so the bar is "does this reply make them more likely to check Fillbook out or keep the conversation going," not "is this shareable/save-worthy on its own." Do not fail a reply for lacking a hook, a mechanism explainer, or CTA it was never meant to carry.`,

  fact_checker: `You verify factual claims against ONLY the verified knowledge provided to you below -- you have no other source of truth about Fillbook. Every material claim about Fillbook's product, pricing, features, or scale must be traceable to the verified knowledge text. If the content makes a claim not supported by the verified knowledge (even a claim that "sounds right"), that is a FAIL -- do not use your own general knowledge or assumptions about what a trading journal might do. If the content makes no factual product claims at all (pure trading education, psychology content, etc.), pass with a note that no claims required verification.`,

  integrity_reviewer: `You check content against Fillbook's forbidden growth tactics: no purchased followers/engagement, no engagement pods or bot networks, no fake testimonials or results, no misleading claims, no hashtag spam, no trending-topic hijacking for irrelevant reach, no shadowban-evasion tactics, no disguising automation as human activity, no fake urgency, no excessive rhetorical questions or emoji as engagement bait. Judge ONLY whether this content or its described execution plan uses any of these tactics.`,

  conversion_reviewer: `You review the call-to-action and conversion mechanics of Fillbook content. Fillbook's CTA philosophy: the product shown must be evidence of a mechanism, never a feature list; product must never read as an advertisement. Judge whether any CTA present is earned by the content (follows naturally from real value delivered) rather than bolted on, and whether it respects the CTA philosophy. If there is no CTA, pass -- not every piece needs one.`,
};

/**
 * Runs one review agent against a candidate piece of content, forcing a
 * structured verdict via tool use rather than parsing free text.
 */
export async function runReviewAgent(
  client: LlmClient,
  agent: ReviewAgentName,
  candidateText: string,
  context: ReviewContext,
): Promise<ReviewVerdict> {
  const systemPrompt = AGENT_SYSTEM_PROMPTS[agent];
  const userMessage = [
    `Platform: ${context.platform}`,
    context.isReply
      ? "Content format: this is a REPLY to a real X user's mention of Fillbook, not a standalone post -- see your instructions above for how that changes what to judge."
      : null,
    "",
    "Brand rules (for context, another mechanical check already covers exact prohibited phrases):",
    context.brandRulesSummary || "(none provided)",
    "",
    "Verified knowledge available to ground factual claims:",
    context.verifiedKnowledgeSummary || "(none provided -- this content should make no factual product claims)",
    "",
    "Content to review:",
    "---",
    candidateText,
    "---",
  ].join("\n");

  const input = await client.callTool<VerdictToolInput>(systemPrompt, userMessage, VERDICT_TOOL_NAME, VERDICT_SCHEMA);

  return {
    agent,
    pass: input.pass,
    score: input.score,
    reasoning: input.reasoning,
    issues: input.issues,
  };
}
