/**
 * Discovery queries for Prospecting's X search. Each query maps to a topic
 * label used for the "why this surfaced" context shown in the app, and a
 * reply class (A/B/C) matching the framework from the 2026-09-02 growth
 * review: a post doesn't need to be an almost-perfect Fillbook product
 * match to be reply-worthy -- it needs to be a conversation Fillbook can
 * add a genuinely useful observation to.
 *
 *   CLASS A -- direct fit: journaling, prop-firm rules, drawdown/
 *              consistency, the exact territory Fillbook is built for.
 *   CLASS B -- adjacent fit: broader trading-psychology/behavior topics
 *              (tilt, sizing, FOMO, losing streaks) that don't mention
 *              journaling but are still natural Fillbook conversation
 *              entry points.
 *   CLASS C -- relationship fit: credible futures traders/creators
 *              posting about process/psychology/execution in general --
 *              no Fillbook mention required, the goal is a smart,
 *              useful observation and long-term recognition.
 *
 * Deliberately a plain code list, not a database table -- nothing else in
 * this codebase has an admin UI for config, and this is the same
 * expand-via-code-change convention as every other list in the repo
 * (KNOWN_EXTERNAL_WRITE_ACTIONS, PRICING_PER_MILLION_TOKENS, etc.).
 *
 * Sourced from the user's own supplied phrase list (2026-09-02 growth
 * review), fillbookhq/docs/social/MASTER_SOCIAL_STRATEGY.md's directional
 * target, and COMMUNITY_INTELLIGENCE.md's observed trader language --
 * not invented fresh here. Fillbook = futures broadly (index, energy,
 * metals, rates, grains, FX futures, prop-firm/funded futures), not only
 * MNQ/NQ -- queries are written to avoid over-narrowing to one instrument.
 */
export interface ProspectingTopic {
  /** Stable key stored on prospecting_candidates.discovery_query -- do not rename an existing key without a data migration. */
  key: string;
  /** X search query string (X search syntax -- quotes for phrases, OR for alternatives). */
  query: string;
  /** Human-readable label shown in the app ("why this surfaced"). */
  label: string;
  /** A = direct fit, B = adjacent fit, C = relationship fit -- see file doc comment. Drives scoring weight (scoreProspectingCandidate). */
  replyClass: "A" | "B" | "C";
}

export const PROSPECTING_TOPICS: ProspectingTopic[] = [
  // ---- CLASS A -- direct fit ----
  { key: "revenge_trading", query: '"revenge trading"', label: "Revenge trading", replyClass: "A" },
  { key: "overtrading", query: "overtrading trading", label: "Overtrading", replyClass: "A" },
  { key: "trading_journal", query: '"trading journal"', label: "Trading journal", replyClass: "A" },
  { key: "expectancy", query: "trading expectancy", label: "Expectancy", replyClass: "A" },
  { key: "consistency_rule", query: '"consistency rule" OR "consistency" prop', label: "Consistency rule", replyClass: "A" },
  { key: "drawdown", query: "drawdown trading account", label: "Drawdown", replyClass: "A" },
  { key: "trailing_drawdown", query: '"trailing drawdown"', label: "Trailing drawdown", replyClass: "A" },
  { key: "prop_firm", query: '"prop firm"', label: "Prop firm", replyClass: "A" },
  { key: "funded_account", query: '"funded account"', label: "Funded account", replyClass: "A" },
  { key: "funded_discipline", query: "funded account discipline", label: "Funded-account discipline", replyClass: "A" },
  { key: "behavior_tracking", query: "trading behavior tracking", label: "Behavior tracking", replyClass: "A" },
  { key: "plan_adherence", query: '"trading plan" (follow OR stick OR broke)', label: "Plan adherence", replyClass: "A" },
  { key: "trade_review", query: '"trade review"', label: "Trade review", replyClass: "A" },
  { key: "trading_mistakes", query: "trading mistakes review", label: "Trade-review mistakes", replyClass: "A" },
  { key: "first_loss", query: "first loss trading behavior", label: "First-loss behavior", replyClass: "A" },
  { key: "why_i_lost", query: '"why I lost" trading', label: "Why I lost", replyClass: "A" },
  { key: "blown_account", query: '"blew my account" OR "blown account"', label: "Blown account", replyClass: "A" },
  { key: "broke_rules", query: '"broke my rules" OR "broke rules" trading', label: "Broke my rules", replyClass: "A" },

  // ---- CLASS B -- adjacent fit ----
  { key: "position_sizing", query: '"position sizing"', label: "Position sizing", replyClass: "B" },
  { key: "sized_up", query: '"sized up" trading loss', label: "Sizing up after losses", replyClass: "B" },
  { key: "tilt", query: "trading tilt", label: "Trading tilt", replyClass: "B" },
  { key: "losing_streak", query: '"losing streak" trading', label: "Losing streak", replyClass: "B" },
  { key: "fomo_trading", query: "FOMO trading", label: "FOMO", replyClass: "B" },
  { key: "trading_psychology", query: '"trading psychology"', label: "Trading psychology", replyClass: "B" },
  { key: "execution_trading", query: "trade execution consistency", label: "Execution consistency", replyClass: "B" },
  { key: "daily_loss", query: '"daily loss limit"', label: "Daily loss limit", replyClass: "B" },
  { key: "strategy_hopping", query: "strategy hopping trading", label: "Strategy hopping", replyClass: "B" },
  { key: "trading_routine", query: '"trading routine" OR "trading process"', label: "Trading routine", replyClass: "B" },
  { key: "risk_management", query: '"risk management" futures', label: "Risk management (futures)", replyClass: "B" },
  { key: "gave_back_profits", query: '"gave back" profits trading', label: "Gave back profits", replyClass: "B" },
  { key: "too_many_trades", query: '"too many trades" trading', label: "Overtrading volume", replyClass: "B" },
  { key: "hesitation_trading", query: "hesitation trading entry", label: "Hesitation", replyClass: "B" },
  { key: "holding_losers", query: "holding losers cutting winners", label: "Holding losers", replyClass: "B" },
  { key: "bad_trading_day", query: '"bad trading day"', label: "Bad trading day", replyClass: "B" },

  // ---- CLASS C -- relationship fit (credible futures traders/creators, no Fillbook fit required) ----
  { key: "futures_trader", query: '"futures trader" process OR psychology', label: "Futures trader", replyClass: "C" },
  { key: "futures_trading_general", query: '"futures trading"', label: "Futures trading", replyClass: "C" },
  { key: "mnq_nq", query: "(MNQ OR NQ OR ES OR MES) futures trading", label: "Index futures (MNQ/NQ/ES)", replyClass: "C" },
  { key: "energy_futures", query: "(crude oil OR CL) futures trading", label: "Energy futures", replyClass: "C" },
  { key: "metals_futures", query: "(gold OR GC OR silver) futures trading", label: "Metals futures", replyClass: "C" },
  { key: "rates_futures", query: "(treasury OR bonds) futures trading", label: "Rates futures", replyClass: "C" },
];

const TOPIC_BY_KEY = new Map(PROSPECTING_TOPICS.map((t) => [t.key, t]));

/** Resolves a stored discovery_query key back to its human-readable label for API responses. Falls back to the raw key (rather than throwing) so a candidate discovered under a topic later removed from this list still displays something sane instead of erroring the whole queue. */
export function discoveryLabelForKey(key: string): string {
  return TOPIC_BY_KEY.get(key)?.label ?? key;
}

/** Resolves a stored discovery_query key to its reply class -- defaults to "B" (adjacent fit) for a topic later removed from this list, a safer default than assuming "A". */
export function replyClassForKey(key: string): "A" | "B" | "C" {
  return TOPIC_BY_KEY.get(key)?.replyClass ?? "B";
}
