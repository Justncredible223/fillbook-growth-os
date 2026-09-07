/**
 * Zero-cost, deterministic relevance gate -- a real, confirmed bug this
 * closes: Prospecting surfaced posts with zero connection to futures/
 * prop-firm trading (a sci-fi story teaser scored 51 and got queued
 * under the "Hesitation" topic purely from generic engagement/length
 * heuristics in prospectingScoring.ts, which never checks the post text
 * itself for trading-domain content). This runs BEFORE any LLM call is
 * made to draft a reply -- an irrelevant candidate is skipped for $0,
 * never reaching the reply writer at all.
 *
 * Deliberately a curated allowlist of DISTINCTIVE trading/markets/
 * prop-firm terms and phrases -- never a bare generic word like "event",
 * "entry", "discipline", or "performance" on its own, which would match
 * huge swaths of unrelated content (self-help, sports, corporate
 * reviews, etc.). "futures" is one signal among many, not required --
 * "prop firm", "funded account", "drawdown", "trading journal" and
 * similar are each sufficient on their own, matching real prop-firm/
 * trading-discipline conversation even when the word "futures" never
 * appears.
 *
 * This is a coarse, conservative SAFETY NET, not a precision classifier
 * -- same tradeoff already accepted elsewhere in this codebase (e.g.
 * xReplyGuardrails.ts's phrase-based checks): a false negative here
 * (missing a genuinely relevant post phrased unusually) just means one
 * fewer candidate gets drafted, which is safe; a false positive (letting
 * through an unrelated post) is exactly the bug being fixed, so the list
 * favors precision over recall.
 */

const TRADING_RELEVANCE_PATTERNS: RegExp[] = [
  // Direct domain anchors
  /\bfutures?\b/i,
  /\bforex\b/i,
  /\btrader\b/i,
  /\btrading\b/i,
  /\bday ?trading\b/i,
  /\bswing trading\b/i,
  /\bscalp(ing|ed|er)?\b/i,
  /\bbacktest(ing|ed)?\b/i,
  /\bstock market\b/i,
  /\boptions? market\b/i,
  /\bmarket (maker|open|close)\b/i,
  /\bpremarket\b/i,
  /\bbrokerage\b/i,

  // Prop-firm / funded-account context
  /\bprop firm\b/i,
  /\bprop trading\b/i,
  /\bfunded (accounts?|traders?)\b/i,
  /\bevaluation account\b/i,
  /\bpayout (request|split|approved)\b/i,
  /\btrading combine\b/i,

  // Trading discipline / risk / psychology vocabulary
  /\b(trailing )?drawdown\b/i,
  /\bovertrading\b/i,
  /\brevenge trading\b/i,
  /\btrading (tilt|psychology|plan|routine|journal|process|strategy)\b/i,
  /\btrade (journal|review|execution)\b/i,
  /\bposition sizing\b/i,
  /\brisk management\b/i,
  /\bconsistency rule\b/i,
  /\bdaily loss limit\b/i,
  /\bstop[- ]loss\b/i,
  /\btake[- ]profit\b/i,
  /\bmargin call\b/i,
  /\bliquidat(ed|ion)\b/i,
  /\bleverage\b/i,
  /\blosing streak\b/i,
  /\b(blew|blown) (my |the )?account\b/i,
  /\bbroke (my )?(trading )?rules?\b/i,
  /\bstrategy hopping\b/i,
  /\bholding losers\b/i,
  /\btrading expectancy\b/i,

  // Instrument-specific (only when paired with an explicit futures/trading
  // context word elsewhere in the same post is NOT required here -- these
  // patterns already anchor the instrument to a futures/trading term).
  /\b(mnq|nq|es|mes)\s+futures\b/i,
  /\b(crude oil|natural gas)\s+futures\b/i,
  /\b(gold|silver)\s+futures\b/i,
];

/**
 * True if [postText] contains at least one distinctive futures/markets/
 * prop-trading signal. Used as a pre-drafting gate in
 * prospectingHandlers.ts -- an irrelevant candidate is skipped (moved to
 * 'not_relevant') before any LLM call, never reaching draftProspectingReply.
 */
export function isPlausiblyTradingRelated(postText: string): boolean {
  return TRADING_RELEVANCE_PATTERNS.some((pattern) => pattern.test(postText));
}
