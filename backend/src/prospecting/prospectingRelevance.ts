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
 *
 * Real bug this closed a second time (2026-09-07): crypto-only posts
 * (e.g. "$USELESS locked in the profits... a 15% move in less than 2h")
 * were being surfaced as actionable Prospecting cards because this gate
 * only ran when the owner tapped Draft reply (see
 * prospectingHandlers.ts's listProspectingQueue, which now applies it
 * before a candidate is ever shown). Investigating that bug also found
 * a real gap in this list itself: "overtrading" was a standalone-
 * sufficient signal, but it's genuinely a generic-enough word (unlike
 * "prop firm" or "funded account") that it doesn't reliably anchor a
 * post to futures/trading-discipline content on its own -- it was
 * removed as a standalone pattern for that reason. A post that
 * genuinely discusses overtrading in a futures/prop-firm context still
 * passes via one of its own other anchors (e.g. "funded account",
 * "drawdown", "revenge trading"), so no real coverage is lost; a crypto
 * post that merely happens to share vocabulary with trading discourse
 * is exactly what removing it protects against. The same reasoning
 * means no bare word like "volume", "discipline", "performance",
 * "entry", "move", or "profits" is ever added to this list alone --
 * each of those independently matches vast unrelated content (including
 * ordinary crypto-only posts), so a real relevance decision always
 * requires one of the distinctive, multi-word or domain-specific
 * patterns below.
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
 * Posts that match at least one of these are almost certainly about
 * automated/algorithmic trading systems, not the manual-discipline
 * traders Fillbook serves. We exclude them even when they also contain
 * a TRADING_RELEVANCE_PATTERNS match (e.g. "automated trading" matches
 * both /\btrading\b/ and this list -- the exclusion wins).
 *
 * The override patterns below let a post survive exclusion when it's
 * clearly about manual discipline *in addition to* mentioning automation.
 */
const AUTOMATED_TRADING_EXCLUSION_PATTERNS: RegExp[] = [
  /\bautomated trading\b/i,
  /\balgo(rithmic)? trading\b/i,
  /\btrading bot\b/i,
  /\btrading (robot|algorithm|system|EA)\b/i,
  /\bexpert advisor\b/i,
  /\bcopy trading\b/i,
  /\bhigh[- ]frequency trading\b/i,
  /\bHFT\b/,
  /\bsmart grid\b/i,
  /\bquantitative trading\b/i,
  /\bquant trader\b/i,
  /\bautotrading\b/i,
];

/** These override the exclusion list when also present -- a post about
 *  algo tools that also discusses prop-firm rules or manual psychology
 *  is still worth showing. */
const MANUAL_DISCIPLINE_OVERRIDE_PATTERNS: RegExp[] = [
  /\bprop firm\b/i,
  /\bfunded (account|trader)\b/i,
  /\b(trailing )?drawdown\b/i,
  /\brevenge trading\b/i,
  /\btrading (journal|psychology|plan|routine)\b/i,
  /\b(blew|blown) (my |the )?account\b/i,
  /\bdaily loss limit\b/i,
  /\bposition sizing\b/i,
];

/**
 * True if [postText] contains at least one distinctive futures/markets/
 * prop-trading signal AND is not primarily about automated/algorithmic
 * trading systems. Used as a pre-drafting gate in prospectingHandlers.ts.
 */
export function isPlausiblyTradingRelated(postText: string): boolean {
  if (!TRADING_RELEVANCE_PATTERNS.some((p) => p.test(postText))) return false;
  if (AUTOMATED_TRADING_EXCLUSION_PATTERNS.some((p) => p.test(postText))) {
    // Allow through only if there's also clear manual-discipline content
    return MANUAL_DISCIPLINE_OVERRIDE_PATTERNS.some((p) => p.test(postText));
  }
  return true;
}
