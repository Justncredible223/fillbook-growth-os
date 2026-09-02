import type { InboundPriority } from "./types.js";

/**
 * Matches text that's pure low-effort engagement -- emoji-only, a single
 * short word of hype, or nothing but punctuation. Deliberately narrow:
 * the spec is explicit that NOT every low-signal reply should disappear,
 * only ones with clearly nothing to respond to. When in doubt, this
 * returns false and the item stays visible at a real priority rather
 * than being silently classified away.
 */
const LOW_VALUE_WORDS = new Set([
  "nice", "cool", "lol", "lmao", "haha", "wow", "great", "love", "this", "facts", "true", "same", "real",
]);

// Matches a string made up entirely of emoji / symbol / whitespace codepoints -- no letters or digits at all.
const EMOJI_OR_SYMBOL_ONLY = /^[\p{Emoji}\p{S}\p{P}\s]+$/u;

export function isLowValue(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (EMOJI_OR_SYMBOL_ONLY.test(trimmed) && /\p{Emoji}/u.test(trimmed)) return true;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (normalized.length > 0 && LOW_VALUE_WORDS.has(normalized)) return true;
  return false;
}

export interface ClassificationInput {
  text: string;
  /** True when this tweet's in_reply_to_user_id equals @FillbookHQ's own resolved user id -- a direct reply to something we posted. */
  isDirectReplyToUs: boolean;
  /** True when referenced_tweets contains a "quoted" entry -- a quote-post, not a plain reply/mention. */
  isQuotePost: boolean;
  /** True when the author is a tracked creator OR has any prior inbound_engagements row -- an existing relationship, not a stranger. */
  hasExistingRelationship: boolean;
}

/**
 * Deterministic, explainable priority classification -- no LLM call, so
 * every mention gets classified even when the AI provider key is
 * missing, and the reasoning is always inspectable. Relationship signal
 * outranks reply-type: a repeat engager replying is P2 even if the
 * specific tweet isn't technically a direct reply, because who it's from
 * matters more than the exact reply mechanics -- matching the explicit
 * priority model (P2 is about the relationship, not the tweet type).
 */
export function classifyPriority(input: ClassificationInput): InboundPriority {
  if (isLowValue(input.text)) return "low_value";
  if (input.hasExistingRelationship) return "p2_relationship";
  if (input.isDirectReplyToUs) return "p1_direct_reply";
  if (input.isQuotePost) return "p4_mention";
  if (input.text.includes("?")) return "p3_comment";
  return "p4_mention";
}
