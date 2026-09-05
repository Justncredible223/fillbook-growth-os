import type { SupabaseClient } from "@supabase/supabase-js";
import type { XSignalAdapter } from "../signals/adapters/xAdapter.js";
import { recordXSearchCostEvent } from "../cost/costTracking.js";
import { PROSPECTING_TOPICS, type ProspectingTopic } from "./prospectingTopics.js";
import { scoreProspectingCandidate } from "./prospectingScoring.js";
import {
  QUEUE_FULL_THRESHOLD,
  RESULTS_PER_QUERY,
  TOPICS_PER_SEARCH_RUN,
  currentRunSlot,
  evaluateMonthlyBudget,
  evaluateQueueCapacity,
  runSlotsPerDay,
  selectTopicsForRun,
} from "./prospectingEligibility.js";
import type { ProspectingRepository } from "./types.js";

export interface ProspectingRunResult {
  skipped: boolean;
  skipReason?: string;
  topicsSearched: string[];
  postsRead: number;
  newCandidates: number;
  excludedAsSpam: number;
  costUsd: number;
}

export interface ProspectingRunDeps {
  adapter: XSignalAdapter;
  repo: ProspectingRepository;
  client: SupabaseClient;
  /** Sum of cost_events.cost_usd for event_type IN ('llm_call','x_search_read') this calendar month -- same "real recorded spend, not estimate" contract as autoDraftEligibility. */
  getMonthSpendUsd: () => Promise<number>;
  now?: Date;
}

/**
 * The Prospecting discovery step: searches a rotating slice of
 * PROSPECTING_TOPICS, scores and dedupes results, and inserts genuinely
 * new candidates. Read-only against X (search only, no write path exists
 * anywhere in XSignalAdapter) and purely additive against Supabase --
 * never modifies or re-surfaces a candidate that's already been shown,
 * replied to, skipped, or marked not-relevant (upsertIfNew is a no-op for
 * any (platform, externalId) already on file).
 */
export async function runProspectingSearch(deps: ProspectingRunDeps): Promise<ProspectingRunResult> {
  const now = deps.now ?? new Date();

  const monthSpend = await deps.getMonthSpendUsd();
  const budgetCheck = evaluateMonthlyBudget(monthSpend);
  if (!budgetCheck.eligible) {
    return { skipped: true, skipReason: budgetCheck.reason, topicsSearched: [], postsRead: 0, newCandidates: 0, excludedAsSpam: 0, costUsd: 0 };
  }

  // Same non-terminal pool prospectingDailySelection.ts draws "today's set"
  // from -- QUEUE_FULL_THRESHOLD is derived from that pool's real target.
  const backlog = await deps.repo.listByStatus(["new", "shown", "drafting", "ready"], QUEUE_FULL_THRESHOLD + 1);
  const queueCheck = evaluateQueueCapacity(backlog.length);
  if (!queueCheck.eligible) {
    return { skipped: true, skipReason: queueCheck.reason, topicsSearched: [], postsRead: 0, newCandidates: 0, excludedAsSpam: 0, costUsd: 0 };
  }

  // Combines the calendar day with which of the daily run slots (see
  // backend/src/config/scheduleConfig.ts's X prospecting schedule -- 08:00/
  // 13:00/18:00 America/Phoenix by default) this invocation is so the
  // rotation advances once per run instead of once per day -- same
  // topic-list cycling behavior as before the 3x/day split, just
  // finer-grained.
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const runIndex = dayIndex * runSlotsPerDay() + currentRunSlot(now);
  const topics: ProspectingTopic[] = selectTopicsForRun(PROSPECTING_TOPICS, runIndex, TOPICS_PER_SEARCH_RUN);

  let postsRead = 0;
  let newCandidates = 0;
  let excludedAsSpam = 0;
  let costUsd = 0;
  const priorOutreachCache = new Map<string, boolean>();

  for (const topic of topics) {
    const results = await deps.adapter.searchRecentPosts(topic.query, RESULTS_PER_QUERY, now);
    postsRead += results.length;
    costUsd += await recordXSearchCostEvent(deps.client, results.length, { topic: topic.key, query: topic.query });

    for (const post of results) {
      let previouslyEngaged = false;
      if (post.authorId) {
        if (priorOutreachCache.has(post.authorId)) {
          previouslyEngaged = priorOutreachCache.get(post.authorId)!;
        } else {
          previouslyEngaged = await deps.repo.hasPriorOutreach("x", post.authorId);
          priorOutreachCache.set(post.authorId, previouslyEngaged);
        }
      }

      const scoreResult = scoreProspectingCandidate({
        topic,
        postText: post.text,
        postCreatedAt: post.createdAt,
        publicMetrics: post.publicMetrics,
        authorFollowerCount: post.authorFollowerCount,
        authorVerified: post.authorVerified,
        previouslyEngaged,
        now,
      });

      if (scoreResult.excluded) {
        excludedAsSpam++;
        continue;
      }

      const { created } = await deps.repo.upsertIfNew({
        platform: "x",
        externalId: post.id,
        discoveryQuery: topic.key,
        authorHandle: post.authorHandle,
        authorExternalId: post.authorId,
        authorName: post.authorName,
        authorFollowerCount: post.authorFollowerCount,
        authorVerified: post.authorVerified,
        postText: post.text,
        postUrl: `https://x.com/i/web/status/${post.id}`,
        postCreatedAt: post.createdAt ? post.createdAt.toISOString() : null,
        publicMetrics: post.publicMetrics ?? {},
        opportunityScore: scoreResult.score,
        scoreBreakdown: scoreResult.breakdown,
        creatorCandidate: (post.authorFollowerCount ?? 0) >= 2000,
        discoveredAt: now.toISOString(),
      });
      if (created) newCandidates++;
    }
  }

  return {
    skipped: false,
    topicsSearched: topics.map((t) => t.key),
    postsRead,
    newCandidates,
    excludedAsSpam,
    costUsd,
  };
}
