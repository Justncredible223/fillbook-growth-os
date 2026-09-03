/**
 * Discovery queries for Prospecting's X search. Each query maps to a topic
 * label used for the "why this surfaced" context shown in the app.
 * Deliberately a plain code list, not a database table -- nothing else in
 * this codebase has an admin UI for config, and this is the same
 * expand-via-code-change convention as every other list in the repo
 * (KNOWN_EXTERNAL_WRITE_ACTIONS, PRICING_PER_MILLION_TOKENS, etc.).
 *
 * Sourced from two places, per the audit requirement in
 * fillbookhq/docs/social/MASTER_SOCIAL_STRATEGY.md's own directional
 * target ("~8-15 worthwhile X reply opportunities/day") and
 * COMMUNITY_INTELLIGENCE.md's observed trader language -- not invented
 * fresh here:
 *   1. Product-category terms the user supplied (prop firm names, trading
 *      terminology).
 *   2. Problem-phrased terms matching how traders actually talk, per
 *      COMMUNITY_INTELLIGENCE.md's Aug 31 2026 signals (e.g. "blown my
 *      account", "one bad trade" -- INITIAL SIGNAL confidence, included
 *      anyway since problem-language tends to surface genuine
 *      conversations, not spam/promo noise).
 *
 * Each query already gets " -is:retweet -is:reply lang:en" appended by
 * XSignalAdapter.searchRecentPosts -- don't duplicate that here.
 */
export interface ProspectingTopic {
  /** Stable key stored on prospecting_candidates.discovery_query -- do not rename an existing key without a data migration. */
  key: string;
  /** X search query string (X search syntax -- quotes for phrases, OR for alternatives). */
  query: string;
  /** Human-readable label shown in the app ("why this surfaced"). */
  label: string;
  /** Which Fillbook capability/expertise area this topic maps to -- feeds the "maps to a feature" ranking factor. */
  relevantFeature: "journaling" | "prop_firm_rules" | "risk_management" | "general_futures";
}

export const PROSPECTING_TOPICS: ProspectingTopic[] = [
  // Prop firm / funded account -- product-category terms
  { key: "prop_firm", query: '"prop firm"', label: "Prop firm discussion", relevantFeature: "prop_firm_rules" },
  { key: "funded_account", query: '"funded account"', label: "Funded account discussion", relevantFeature: "prop_firm_rules" },
  { key: "apex_trader", query: '"Apex" (trader OR funded OR payout)', label: "Apex Trader Funding", relevantFeature: "prop_firm_rules" },
  { key: "topstep", query: "Topstep (trader OR funded OR payout)", label: "Topstep", relevantFeature: "prop_firm_rules" },
  { key: "lucid_trading", query: '"Lucid" (prop OR funded OR trading)', label: "Lucid Trading", relevantFeature: "prop_firm_rules" },
  { key: "bulenox", query: "Bulenox", label: "Bulenox", relevantFeature: "prop_firm_rules" },
  { key: "payout", query: '"payout" (prop OR funded OR firm)', label: "Prop firm payout", relevantFeature: "prop_firm_rules" },
  { key: "consistency_rule", query: '"consistency rule"', label: "Consistency rule", relevantFeature: "prop_firm_rules" },
  { key: "trailing_drawdown", query: '"trailing drawdown"', label: "Trailing drawdown", relevantFeature: "risk_management" },
  { key: "daily_loss_limit", query: '"daily loss limit"', label: "Daily loss limit", relevantFeature: "risk_management" },

  // Journaling / analytics -- product-category terms
  { key: "trading_journal", query: '"trading journal"', label: "Trading journal", relevantFeature: "journaling" },
  { key: "journaling_trades", query: "journaling (trades OR trading)", label: "Journaling trades", relevantFeature: "journaling" },
  { key: "futures_journal", query: '"futures journal"', label: "Futures journal", relevantFeature: "journaling" },
  { key: "trading_analytics", query: '"trading analytics"', label: "Trading analytics", relevantFeature: "journaling" },
  { key: "trade_review", query: '"trade review"', label: "Trade review", relevantFeature: "journaling" },

  // Futures instruments / general -- product-category terms
  { key: "mnq_nq", query: "(MNQ OR NQ) futures trading", label: "MNQ/NQ futures", relevantFeature: "general_futures" },
  { key: "futures_trading", query: '"futures trading"', label: "Futures trading", relevantFeature: "general_futures" },

  // Problem-phrased terms -- how traders actually describe the pain, per
  // COMMUNITY_INTELLIGENCE.md and the user's own supplied list
  { key: "overtrading", query: "overtrading", label: "Overtrading", relevantFeature: "risk_management" },
  { key: "revenge_trading", query: '"revenge trading"', label: "Revenge trading", relevantFeature: "risk_management" },
  { key: "risk_management", query: '"risk management" trading', label: "Risk management", relevantFeature: "risk_management" },
  { key: "position_sizing", query: '"position sizing"', label: "Position sizing", relevantFeature: "risk_management" },
  { key: "drawdown", query: "drawdown trading account", label: "Drawdown", relevantFeature: "risk_management" },
  { key: "trading_discipline", query: '"trading discipline"', label: "Trading discipline", relevantFeature: "journaling" },
  { key: "blown_account", query: '"blew my account" OR "blown account"', label: "Blown account", relevantFeature: "risk_management" },
  { key: "funded_reset", query: '"account reset" (funded OR prop)', label: "Funded account reset", relevantFeature: "prop_firm_rules" },
  { key: "one_bad_trade", query: '"one bad trade"', label: "One bad trade", relevantFeature: "journaling" },
];

const LABEL_BY_KEY = new Map(PROSPECTING_TOPICS.map((t) => [t.key, t.label]));

/** Resolves a stored discovery_query key back to its human-readable label for API responses. Falls back to the raw key (rather than throwing) so a candidate discovered under a topic later removed from this list still displays something sane instead of erroring the whole queue. */
export function discoveryLabelForKey(key: string): string {
  return LABEL_BY_KEY.get(key) ?? key;
}
