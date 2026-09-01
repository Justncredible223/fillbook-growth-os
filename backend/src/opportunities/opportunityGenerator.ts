import type { Signal } from "../signals/types.js";
import type { OpportunityEngine } from "./opportunityEngine.js";
import type { ScoringInput } from "./types.js";

const RELEVANT_KEYWORDS = [
  "trad",
  "prop firm",
  "funded",
  "drawdown",
  "journal",
  "futures",
  "revenge",
  "breach",
  "risk",
  "discipline",
  "edge",
];

export interface RelevanceEstimate {
  fillbookRelevance: number;
  audienceRelevance: number;
}

/**
 * Heuristic keyword-based relevance estimate for a signal's text -- a
 * deliberate MVP stand-in for a real classifier, same "simple until
 * volume justifies more" posture as SignalGraph's own topic clustering.
 * Grounded in the signal's actual text (more matched keywords -> higher
 * relevance, capped at 1), not invented from nothing.
 */
export function estimateRelevance(text: string): RelevanceEstimate {
  const lower = text.toLowerCase();
  const hits = RELEVANT_KEYWORDS.filter((k) => lower.includes(k)).length;
  return {
    fillbookRelevance: Math.min(1, 0.35 + hits * 0.15),
    // Audience relevance tracks the same keyword signal rather than an
    // independent estimate -- these are already mentions of @FillbookHQ
    // or content already about a matched search query, so the question
    // is "how on-topic is it", not "is the audience real".
    audienceRelevance: Math.min(1, 0.5 + hits * 0.1),
  };
}

function extractText(signal: Signal): string {
  const ev = signal.evidence as Record<string, unknown>;
  if (typeof ev.text === "string") return ev.text; // x_mention
  if (typeof ev.title === "string") return ev.title; // youtube_video
  if (typeof ev.query === "string") return ev.query; // search_console_query
  return signal.topic ?? "";
}

function platformForSource(source: string): string {
  if (source === "x_mention") return "x";
  if (source === "youtube_video") return "youtube";
  if (source === "search_console_query") return "blog";
  return "x";
}

function truncate(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export interface GenerateOpportunitiesResult {
  created: number;
  skipped: number;
}

/**
 * Turns not-yet-covered signals into real Opportunity rows via the
 * existing OpportunityEngine/scoreOpportunity() -- the piece that was
 * missing between Signal Graph (Phase 4) and Opportunity Engine (Phase
 * 5) despite both existing independently and working in isolation.
 *
 * One opportunity per signal for un-topic'd sources (x_mention,
 * youtube_video -- each is already a distinct, individually-actionable
 * event). One opportunity per topic cluster for topic'd sources
 * (search_console_query), since repeat observations of the same query
 * genuinely are the same topic, not separate events.
 */
export async function generateOpportunitiesFromSignals(
  engine: OpportunityEngine,
  recentSignals: Signal[],
  alreadyCoveredSignalIds: ReadonlySet<string>,
): Promise<GenerateOpportunitiesResult> {
  let created = 0;
  let skipped = 0;

  const byTopic = new Map<string, Signal[]>();
  const untopicSignals: Signal[] = [];

  for (const signal of recentSignals) {
    if (alreadyCoveredSignalIds.has(signal.id)) {
      skipped++;
      continue;
    }
    if (signal.topic) {
      const group = byTopic.get(signal.topic) ?? [];
      group.push(signal);
      byTopic.set(signal.topic, group);
    } else {
      untopicSignals.push(signal);
    }
  }

  for (const signal of untopicSignals) {
    const text = extractText(signal);
    const { fillbookRelevance, audienceRelevance } = estimateRelevance(text);
    const input: ScoringInput = {
      title: `${signal.source}: ${truncate(text)}`,
      audienceRelevance,
      fillbookRelevance,
      velocity: 1,
      confidence: signal.confidence,
      daysSinceLastCoveredSameTopic: null,
      duplicateOpenCount: 0,
      signalIds: [signal.id],
      recommendedChannels: [platformForSource(signal.source)],
    };
    await engine.createFromEvidence(input);
    created++;
  }

  for (const [topic, group] of byTopic) {
    const latest = group[0]!;
    const text = extractText(latest) || topic;
    const { fillbookRelevance, audienceRelevance } = estimateRelevance(text);
    const input: ScoringInput = {
      title: `${latest.source}: ${truncate(topic)}`,
      audienceRelevance,
      fillbookRelevance,
      velocity: group.length,
      confidence: Math.max(...group.map((s) => s.confidence)),
      daysSinceLastCoveredSameTopic: null,
      duplicateOpenCount: 0,
      signalIds: group.map((s) => s.id),
      recommendedChannels: [platformForSource(latest.source)],
    };
    await engine.createFromEvidence(input);
    created++;
  }

  return { created, skipped };
}
