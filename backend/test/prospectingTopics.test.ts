import { describe, it, expect } from "vitest";
import { PROSPECTING_TOPICS } from "../src/prospecting/prospectingTopics";
import { isPlausiblyTradingRelated } from "../src/prospecting/prospectingRelevance";

/**
 * Regression coverage for a real, confirmed bug (2026-09-07): a topic's X
 * search query can find genuine candidates that ingestion happily accepts
 * as "new", only for prospectingHandlers.ts's listProspectingQueue() to
 * silently reclassify every one of them as 'not_relevant' the instant the
 * app fetches the queue -- because the query's own guaranteed phrase
 * never actually satisfies isPlausiblyTradingRelated()'s anchor list.
 * Confirmed live for "too_many_trades" (4 of 4 candidates from one real
 * run never reached the app) and "overtrading" (no anchor at all).
 *
 * For every topic whose query is unambiguous (a single quoted phrase,
 * optionally with one or more required bare words -- no OR/parentheses,
 * since only one branch of an OR is guaranteed present), this asserts
 * that the literal, minimal text X search guarantees a match on actually
 * passes the relevance gate. A topic added later that has this same gap
 * will fail this test immediately instead of silently starving the
 * Prospecting queue in production.
 */
function isUnambiguousQuery(query: string): boolean {
  return !query.includes(" OR ") && !query.includes("(");
}

/** Minimal literal text an unambiguous query is guaranteed to match: every quoted phrase plus every bare (unquoted) word, space-joined. */
function minimalMatchingText(query: string): string {
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const bareWords = query.replace(/"[^"]+"/g, "").trim();
  return [...quoted, bareWords].filter(Boolean).join(" ");
}

describe("PROSPECTING_TOPICS queries are guaranteed to pass isPlausiblyTradingRelated", () => {
  const unambiguousTopics = PROSPECTING_TOPICS.filter((t) => isUnambiguousQuery(t.query));

  it("covers a meaningful majority of the topic list (sanity check the parser isn't skipping everything)", () => {
    expect(unambiguousTopics.length).toBeGreaterThan(PROSPECTING_TOPICS.length / 2);
  });

  for (const topic of unambiguousTopics) {
    it(`"${topic.key}" (query: ${topic.query})`, () => {
      const text = minimalMatchingText(topic.query);
      expect(isPlausiblyTradingRelated(text)).toBe(true);
    });
  }
});
