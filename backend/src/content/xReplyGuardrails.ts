/**
 * Deterministic, $0 safety net for reply drafts (Prospecting's cold
 * outreach, Inbound's replies-to-engagement) -- catches the WORST,
 * objectively-bannable patterns (generic marketing phrases, an
 * unexplained link, an unverifiable performance/customer claim)
 * mechanically, so they never depend on an LLM reviewer noticing. This is
 * deliberately narrow: it does not and cannot judge whether a reply
 * "sounds natural" or is "too generic" -- those are genuine judgment
 * calls this project leaves to the writer prompt and human review, not
 * something a keyword check can honestly claim to verify. Same
 * phrase-based house style as discoveryScoring.ts's
 * hasConcretePartnershipBasis -- not an LLM classification, so this adds
 * no cost and every match is traceable to an exact phrase.
 */

const BANNED_GENERIC_PHRASES = ["check out our platform", "check out our product", "learn more", "dm me", "dm us", "sign up today", "click here", "link in bio"];

export interface GuardrailViolation {
  reason: string;
}

/** True if the reply uses one of the generic marketing phrases this project's brand voice explicitly bans, regardless of platform. */
export function containsBannedGenericPhrase(reply: string): GuardrailViolation | null {
  const lower = reply.toLowerCase();
  const matched = BANNED_GENERIC_PHRASES.find((phrase) => lower.includes(phrase));
  return matched ? { reason: `uses the banned generic phrase "${matched}"` } : null;
}

/** Matches a real URL, or a bare-domain mention (e.g. "fillbookhq.com") -- a link doesn't need "http://" to read as a link/CTA in a tweet. */
const LINK_PATTERN = /https?:\/\/\S+|\b[a-z0-9-]+\.(com|io|co|app|net)\b/i;

/** True if the reply text contains anything link-shaped. Callers decide whether that's expected (usesLink=true, on a platform/context where a link is allowed) or a violation (a link slipped in by default). */
export function containsLink(reply: string): boolean {
  return LINK_PATTERN.test(reply);
}

/**
 * Patterns for the two things this project's brand rules explicitly ban:
 * Fillbook (a company) speaking as if it personally trades, and any
 * customer/performance claim not grounded in verified knowledge. Kept
 * intentionally narrow and literal (not a general sentiment classifier)
 * so a false positive here is rare and a match is always defensible.
 */
const UNVERIFIED_CLAIM_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bour (customers|users|members|traders)\b[^.!?]{0,60}\b(saved|improved|increased|reduced|grew|made|earned)\b/i, reason: "claims a customer/user result not grounded in verified knowledge" },
  { pattern: /\b\d{1,3}\s*%\s*(more|less|better|faster|improvement|increase|reduction)\b/i, reason: "cites an unverified performance statistic" },
  { pattern: /\bi(?:'ve| have)\b[^.!?]{0,40}\b(made|earned|traded|profited)\b/i, reason: "speaks in first person about personally trading, which Fillbook (a product) must never do" },
  { pattern: /\bguarantee(d|s)?\b/i, reason: "makes a guarantee, which is never verifiable" },
  { pattern: /\bproven to\b/i, reason: "claims something is \"proven\" without grounding" },
];

/** True (with a reason) if the reply makes an unverified personal-trading, customer-result, or guarantee-style claim. Returns null for a clean reply. */
export function containsUnverifiedClaim(reply: string): GuardrailViolation | null {
  const match = UNVERIFIED_CLAIM_PATTERNS.find(({ pattern }) => pattern.test(reply));
  return match ? { reason: match.reason } : null;
}

/**
 * Runs every mechanical check and returns the first violation found, or
 * null for a clean reply. `expectsLink` should be true only when the
 * caller's own context says a link is deliberately present and allowed
 * (e.g. usesLink=true on a platform where that's earned) -- otherwise any
 * link-shaped text is treated as a violation of "never include a link by
 * default".
 */
export function checkReplyGuardrails(reply: string, expectsLink: boolean): GuardrailViolation | null {
  const genericPhrase = containsBannedGenericPhrase(reply);
  if (genericPhrase) return genericPhrase;

  const unverifiedClaim = containsUnverifiedClaim(reply);
  if (unverifiedClaim) return unverifiedClaim;

  if (!expectsLink && containsLink(reply)) {
    return { reason: "includes a link that wasn't declared as intentional (usesLink was false or absent)" };
  }

  return null;
}
