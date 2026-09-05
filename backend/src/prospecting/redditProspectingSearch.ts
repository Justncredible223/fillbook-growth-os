import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedditSignalAdapter } from "../signals/adapters/redditAdapter.js";
import { REDDIT_TOPICS, type RedditTopic } from "./redditTopics.js";
import { scoreProspectingCandidate } from "./prospectingScoring.js";
import { selectTopicsForRun } from "./prospectingEligibility.js";
import { REDDIT_QUEUE_FULL_THRESHOLD, REDDIT_RESULTS_PER_QUERY, REDDIT_TOPICS_PER_RUN, evaluateRedditQueueCapacity } from "./redditEligibility.js";
import { recordRedditReadCostEvent } from "../cost/costTracking.js";
import type { ProspectingRepository } from "./types.js";

export interface RedditProspectingRunResult {
  skipped: boolean;
  skipReason?: string;
  topicsSearched: string[];
  postsRead: number;
  newCandidates: number;
  excludedAsSpam: number;
}

export interface RedditProspectingRunDeps {
  adapter: RedditSignalAdapter;
  repo: ProspectingRepository;
  client: SupabaseClient;
  now?: Date;
}

/**
 * The Reddit prospecting discovery step -- 1x/day (see
 * backend/src/config/scheduleConfig.ts). Same read-only, dedup-by-
 * (platform,externalId), score-then-insert shape as
 * prospectingSearch.ts's X version, reusing the identical
 * scoreProspectingCandidate() function: a RedditTopic has the same
 * key/query/label/replyClass shape scoring reads, and Reddit's
 * score/num_comments map onto the same "active discussion" inputs X's
 * public_metrics does. Deliberately does NOT reuse X's
 * QUEUE_FULL_THRESHOLD/MONTHLY_PROSPECTING_BUDGET_USD -- Reddit has no
 * per-call dollar cost and a much smaller daily target (~3-4 vs ~15), so it
 * gets its own, smaller thresholds (redditEligibility.ts).
 */
export async function runRedditProspectingSearch(deps: RedditProspectingRunDeps): Promise<RedditProspectingRunResult> {
  const now = deps.now ?? new Date();

  const backlog = await deps.repo.listByStatus(["new", "shown", "drafting", "ready"], REDDIT_QUEUE_FULL_THRESHOLD + 1);
  const redditBacklog = backlog.filter((c) => c.platform === "reddit");
  const queueCheck = evaluateRedditQueueCapacity(redditBacklog.length);
  if (!queueCheck.eligible) {
    return { skipped: true, skipReason: queueCheck.reason, topicsSearched: [], postsRead: 0, newCandidates: 0, excludedAsSpam: 0 };
  }

  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  const topics: RedditTopic[] = selectTopicsForRun(REDDIT_TOPICS, dayIndex, REDDIT_TOPICS_PER_RUN);

  let postsRead = 0;
  let newCandidates = 0;
  let excludedAsSpam = 0;
  const priorOutreachCache = new Map<string, boolean>();

  for (const topic of topics) {
    const results = await deps.adapter.searchSubreddit(topic.subreddit, topic.query, REDDIT_RESULTS_PER_QUERY, now);
    postsRead += results.length;
    await recordRedditReadCostEvent(deps.client, results.length, { topic: topic.key, subreddit: topic.subreddit, query: topic.query });

    for (const post of results) {
      const authorKey = post.authorHandle;
      let previouslyEngaged = false;
      if (authorKey) {
        if (priorOutreachCache.has(authorKey)) {
          previouslyEngaged = priorOutreachCache.get(authorKey)!;
        } else {
          previouslyEngaged = await deps.repo.hasPriorOutreach("reddit", authorKey);
          priorOutreachCache.set(authorKey, previouslyEngaged);
        }
      }

      const postText = post.title + (post.selftext ? `\n\n${post.selftext}` : "");
      const scoreResult = scoreProspectingCandidate({
        topic,
        postText,
        postCreatedAt: post.createdAt,
        publicMetrics: { reply_count: post.numComments, like_count: post.score },
        authorFollowerCount: null, // Reddit exposes karma, not a meaningful "reach" analog to X followers -- not treated as a reach signal here, matching this scoring function's own "not follower-dominant" design intent.
        authorVerified: false, // Reddit has no equivalent "verified account" concept.
        previouslyEngaged,
        now,
      });

      if (scoreResult.excluded) {
        excludedAsSpam++;
        continue;
      }

      const { created } = await deps.repo.upsertIfNew({
        platform: "reddit",
        externalId: post.fullname,
        discoveryQuery: topic.key,
        authorHandle: post.authorHandle,
        authorExternalId: post.authorHandle, // Reddit's search API doesn't return a stable numeric author id -- the username IS the stable identifier the inbox/mentions API also keys on.
        authorName: post.authorHandle,
        authorFollowerCount: null,
        authorVerified: false,
        postText,
        postUrl: post.permalink,
        postCreatedAt: post.createdAt ? post.createdAt.toISOString() : null,
        publicMetrics: { reply_count: post.numComments, like_count: post.score },
        opportunityScore: scoreResult.score,
        scoreBreakdown: scoreResult.breakdown,
        creatorCandidate: false, // No follower-count heuristic available on Reddit -- see authorFollowerCount note above.
        discoveredAt: now.toISOString(),
      });
      if (created) newCandidates++;
    }
  }

  return { skipped: false, topicsSearched: topics.map((t) => t.key), postsRead, newCandidates, excludedAsSpam };
}
