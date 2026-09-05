/**
 * Discovery queries for Reddit prospecting -- the subreddit-scoped
 * equivalent of prospectingTopics.ts's X query list. Reuses the same A/B/C
 * reply-class framework (see prospectingTopics.ts's doc comment) so
 * scoreProspectingCandidate's CLASS_WEIGHT applies unchanged.
 *
 * Subreddits chosen for genuine overlap with Fillbook's actual audience
 * (futures/prop-firm/funded-account traders and trading-journal habits),
 * not a maximal list -- "search only configured relevant subreddits" per
 * the approved spec, and Reddit's 100 req/min free-tier ceiling means a
 * short, well-targeted list serves the ~3-4/day target better than a long
 * unfocused one.
 */
export interface RedditTopic {
  /** Stable key stored on prospecting_candidates.discovery_query -- do not rename an existing key without a data migration. */
  key: string;
  subreddit: string;
  query: string;
  label: string;
  replyClass: "A" | "B" | "C";
}

export const REDDIT_TOPICS: RedditTopic[] = [
  { key: "reddit_futures_journal", subreddit: "FuturesTrading", query: "journal OR journaling", label: "Futures traders discussing journaling", replyClass: "A" },
  { key: "reddit_propfirm_rules", subreddit: "FundedTrading", query: "drawdown OR consistency rule OR daily loss", label: "Prop-firm drawdown/consistency-rule questions", replyClass: "A" },
  { key: "reddit_daytrading_tilt", subreddit: "Daytrading", query: "revenge trading OR tilt OR overtrading", label: "Daytrading tilt/overtrading discussion", replyClass: "B" },
  { key: "reddit_algotrading_discipline", subreddit: "algotrading", query: "discipline OR process OR routine", label: "Trading process/discipline discussion", replyClass: "C" },
  { key: "reddit_futures_general", subreddit: "FuturesTrading", query: "funded account OR passed evaluation", label: "Funded futures account discussion", replyClass: "A" },
];
