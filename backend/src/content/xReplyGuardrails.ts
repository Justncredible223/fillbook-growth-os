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

const BANNED_GENERIC_PHRASES = [
  "check out our platform",
  "check out our product",
  "learn more",
  "dm me",
  "dm us",
  "sign up today",
  "click here",
  "link in bio",
  // Engagement-bait closers (owner-flagged 2026-09-10, from a real Inbound
  // draft reading as a reply-farming tactic rather than a genuine
  // response): content-free lines whose only job is soliciting another
  // reply, not adding anything to what the person actually said.
  "let's keep the conversation going",
  "keep the conversation going",
  "let's continue the conversation",
  "would love to hear more",
  "let me know your thoughts",
  "what are your thoughts",
];

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
/** Same pattern, global -- used to enumerate every link-shaped match (not just the first) so each one's domain can be checked. */
const LINK_PATTERN_GLOBAL = /https?:\/\/\S+|\b[a-z0-9-]+\.(?:com|io|co|app|net)\b/gi;

/** True if the reply text contains anything link-shaped. Callers decide whether that's expected (usesLink=true, on a platform/context where a link is allowed) or a violation (a link slipped in by default). */
export function containsLink(reply: string): boolean {
  return LINK_PATTERN.test(reply);
}

/** Strips a matched link down to its bare host (no protocol, path, query, or trailing punctuation), lowercased, so it can be compared against an approved-domain allowlist. */
function extractLinkDomains(reply: string): string[] {
  const matches = reply.match(LINK_PATTERN_GLOBAL) ?? [];
  return matches.map((match) => {
    const withoutProtocol = match.replace(/^https?:\/\//i, "");
    const host = withoutProtocol.split(/[/?#]/)[0] ?? withoutProtocol;
    return host.toLowerCase().replace(/[.,!?;:)]+$/, "");
  });
}

/** True if `domain` is (or is a subdomain of) one of `approvedDomains`. */
function isApprovedDomain(domain: string, approvedDomains: string[]): boolean {
  return approvedDomains.some((approved) => domain === approved || domain.endsWith(`.${approved}`));
}

/**
 * Phrase-based, deterministic detector for "this message is clearly asking
 * us for contact info or a link" -- e.g. "how do I contact you", "what's
 * your website", "where can I sign up". Deliberately narrow (same
 * house-style tradeoff as the rest of this file): a false negative here
 * just means a legitimate contact reply can't include a link this time
 * (safe -- Inbound already defaults to no link), while a false positive
 * would let an arbitrary reply attach a link it was never actually asked
 * for, which is the exact hole this function exists to close.
 */
const CONTACT_OR_LINK_REQUEST_PATTERN =
  /\bhow (?:do|can|would) i (?:contact|reach|get in touch with|find|follow) you\b|\bwhere can i (?:contact|reach|find) you\b|\bwhat(?:'s| is) your (?:website|site|link|url)\b|\bhow do i (?:sign up|get started|join)\b|\bwhere do i (?:sign up|get started|join)\b|\bdo you have a (?:link|website|site)\b|\bcan (?:you|i get) (?:a|the) link\b|\bsend me a link\b/i;

/** True if the original inbound message clearly requests contact info or a link -- see the pattern's own docstring for why this stays deliberately narrow. */
export function impliesContactOrLinkRequest(messageText: string): boolean {
  return CONTACT_OR_LINK_REQUEST_PATTERN.test(messageText);
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

export interface ReplyGuardrailOptions {
  /**
   * When given, a link is only accepted if EVERY link-shaped match in the
   * reply resolves to one of these domains (or a subdomain of one) --
   * closes the gap where `expectsLink=true` alone would let any arbitrary
   * or promotional domain through unchecked. Omitted entirely (as
   * Prospecting's existing call site does) preserves the original,
   * unchanged behavior: `expectsLink=true` trusts the caller's own
   * declaration with no domain check.
   */
  approvedLinkDomains?: string[];
}

/**
 * Runs every mechanical check and returns the first violation found, or
 * null for a clean reply. `expectsLink` should be true only when the
 * caller's own context says a link is deliberately present and allowed
 * (e.g. usesLink=true on a platform where that's earned) -- otherwise any
 * link-shaped text is treated as a violation of "never include a link by
 * default".
 */
export function checkReplyGuardrails(reply: string, expectsLink: boolean, options?: ReplyGuardrailOptions): GuardrailViolation | null {
  const genericPhrase = containsBannedGenericPhrase(reply);
  if (genericPhrase) return genericPhrase;

  const unverifiedClaim = containsUnverifiedClaim(reply);
  if (unverifiedClaim) return unverifiedClaim;

  if (!expectsLink && containsLink(reply)) {
    return { reason: "includes a link that wasn't declared as intentional (usesLink was false or absent)" };
  }

  if (expectsLink && options?.approvedLinkDomains) {
    const disallowed = extractLinkDomains(reply).find((domain) => !isApprovedDomain(domain, options.approvedLinkDomains!));
    if (disallowed) {
      return { reason: `includes a link on a domain that isn't an approved Fillbook link ("${disallowed}")` };
    }
  }

  return null;
}
