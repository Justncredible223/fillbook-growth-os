import type { LlmClient } from "./llmClient.js";

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "A short, specific research title -- not the raw question restated verbatim." },
    question: { type: "string", description: "The research question this addresses, restated clearly." },
    summary: { type: "string", description: "A short executive summary -- a few sentences, the headline takeaway." },
    findings: { type: "array", items: { type: "string" }, description: "Key findings, one per entry -- specific, not generic platitudes." },
    evidenceReferences: {
      type: "array",
      items: { type: "string" },
      description:
        "What each finding is actually grounded in -- ONLY the verified knowledge provided below, cited by its own title. Never a fabricated external URL or study; this tool has no live search/retrieval capability.",
    },
    caveats: {
      type: "array",
      items: { type: "string" },
      description:
        "Limitations, uncertainty, or reasoning not backed by the verified knowledge -- e.g. 'general trading-domain reasoning, not verified against Fillbook's own knowledge base.' Empty array only if every finding is fully evidence-backed, never omitted to look more authoritative.",
    },
    contentAngles: {
      type: "array",
      items: { type: "string" },
      description: "Suggested Fillbook content angles this research could support (a post idea, a video topic, etc.) -- concrete, not generic.",
    },
  },
  required: ["title", "question", "summary", "findings", "evidenceReferences", "caveats", "contentAngles"],
};

interface ResearchToolInput {
  title: string;
  question: string;
  summary: string;
  findings: string[];
  evidenceReferences: string[];
  caveats: string[];
  contentAngles: string[];
}

export interface ResearchReport {
  title: string;
  question: string;
  summary: string;
  findings: string[];
  evidenceReferences: string[];
  caveats: string[];
  contentAngles: string[];
}

const SYSTEM_PROMPT = `You are Fillbook's research analyst. Fillbook is a trading journal for futures day traders and
prop-firm funded accounts (broker-agnostic import, futures-native P&L, prop-firm drawdown/rule tracking, AI
coach) -- positioned against TradeZella/TradesViz (broker-agnostic/stock-first).

You produce a private, internal research document for the owner to review BEFORE it informs any content --
this is never published or shown to anyone else directly. Be precise and honest about what is and isn't
actually known:
- findings: specific, non-generic. Not "traders should manage risk" -- what, specifically, did you find.
- evidenceReferences: ONLY cite the verified knowledge you were given, by its own title. You have no live
  search or retrieval capability -- never invent a study, statistic, external URL, or source that wasn't
  provided to you. If a finding isn't grounded in the verified knowledge, it must NOT have an evidence
  reference claiming it is.
- caveats: be honest about limitations. Any finding based on general trading-domain reasoning rather than
  the verified knowledge provided must be caveated as such, not presented as settled fact. An empty caveats
  list is only correct if every single finding is fully evidence-backed -- do not omit caveats just to look
  more authoritative.
- contentAngles: concrete, Fillbook-specific ideas this research could support -- not generic "make a video
  about this" filler.

Never state an unverified quantitative or comparative claim as flat fact -- e.g. "most funded traders fail
because X." Hedge it explicitly or drop the comparison for a narrower, defensible observation.

Submit your result via the submit_research tool.`;

/**
 * Generates a private, internal research document (title/question/summary/
 * findings/evidence/caveats/content angles) for the owner to review BEFORE
 * it informs any public content -- the same "invent once, review
 * downstream" shape as draftContent/draftVideoScript, but this content
 * shape deliberately skips the nine public-content review agents (see
 * campaignPipeline.ts's own doc comment on isResearch for why: hook_specialist/
 * conversion_reviewer/growth_strategist judge public-facing content
 * mechanics that don't apply to a private research document the owner
 * already has to read in full before using it for anything). Still gated
 * by the same mechanical gate (banned-phrase/duplicate check) every other
 * content type goes through.
 */
export async function draftResearch(
  client: LlmClient,
  opportunity: { title: string; rationale: string },
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<ResearchReport> {
  const userMessage = [
    `Research topic/opportunity: ${opportunity.title}`,
    `Context: ${opportunity.rationale}`,
    "",
    "Brand rules:",
    brandRulesSummary,
    "",
    "Verified knowledge (the ONLY source you may cite as evidence about Fillbook -- do not invent anything else):",
    verifiedKnowledgeSummary || "(none provided -- ground findings in general, clearly-caveated trading-domain reasoning only)",
  ].join("\n");

  const result = await client.callTool<ResearchToolInput>(SYSTEM_PROMPT, userMessage, "submit_research", RESEARCH_SCHEMA);
  return result;
}

/**
 * Flattens a ResearchReport into one readable text block, same reason
 * formatVideoScriptAsText does -- ContentQualityGate, content_versions.body,
 * and the Approvals preview all operate on a single string.
 */
export function formatResearchAsText(report: ResearchReport): string {
  const findings = report.findings.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const evidence = report.evidenceReferences.length > 0 ? report.evidenceReferences.map((e) => `- ${e}`).join("\n") : "(none cited)";
  const caveats = report.caveats.length > 0 ? report.caveats.map((c) => `- ${c}`).join("\n") : "(none)";
  const angles = report.contentAngles.map((a) => `- ${a}`).join("\n");
  return [
    `TITLE: ${report.title}`,
    "",
    `QUESTION: ${report.question}`,
    "",
    "SUMMARY:",
    report.summary,
    "",
    "KEY FINDINGS:",
    findings,
    "",
    "EVIDENCE/SOURCES:",
    evidence,
    "",
    "CAVEATS/LIMITATIONS:",
    caveats,
    "",
    "SUGGESTED CONTENT ANGLES:",
    angles,
  ].join("\n");
}
