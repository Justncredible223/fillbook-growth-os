import type { BrandConstitutionRepository, BrandRule } from "./types.js";

export interface VocabularyViolation {
  rule: BrandRule;
  matchedPhrase: string;
}

/**
 * Claims about HOW Fillbook tracks rules that the product cannot support. Fillbook computes drawdown, daily-loss and
 * consistency buffers from the trades a user has imported or synced (closed trades only). Tradovate syncs on a
 * schedule plus a manual "Sync now"; NinjaTrader sends fills through an add-on while it is running; alerts warn, they
 * do not block orders or protect an account. Wording that says otherwise is blocked before it can reach an X post
 * (three such posts had to be deleted on 2026-09-29).
 *
 * These rules also live in the brand_rules table (migration 0045). They are kept here too, word for word, so the
 * guard holds even if the table is edited or the migration has not been applied yet; a table rule with the same text
 * is used instead of the built-in copy, so a violation is never reported twice.
 */
const SOURCE_DOC = "fillbook:docs/distribution/PRODUCT_FACTS.md";
export const BUILT_IN_CLAIM_RULES: readonly BrandRule[] = [
  {
    id: "builtin:no-realtime-tracking-claims",
    version: 2,
    ruleType: "claim_prohibited",
    content:
      'Never say Fillbook tracks rules or drawdown "in real time" or "live" (real time, real-time, realtime, live drawdown, live tracking, live alerts). Fillbook computes buffers from imported or synced closed trades.',
    sourceDoc: SOURCE_DOC,
    isActive: true,
  },
  {
    id: "builtin:no-coverage-claims",
    version: 2,
    ruleType: "claim_prohibited",
    content:
      'Never say Fillbook "tracks every rule", works with "any broker", or alerts "before a breach" / "before you breach". Alerts warn when a buffer is getting close; they do not block orders or protect an account.',
    sourceDoc: SOURCE_DOC,
    isActive: true,
  },
  {
    id: "builtin:no-outcome-promises",
    version: 2,
    ruleType: "claim_prohibited",
    content: 'Never promise outcomes for Fillbook: no "guarantee" wording and no "never blow an account".',
    sourceDoc: SOURCE_DOC,
    isActive: true,
  },
];

/** Rules whose phrases only matter when the candidate is about Fillbook: a firm's own real-time rules are fair game. */
const PRODUCT_SCOPED_RULE_CONTENTS: ReadonlySet<string> = new Set(BUILT_IN_CLAIM_RULES.map((r) => r.content));

/** Matches "Fillbook", "@FillbookHQ", "fillbookhq.com" and hashtags of the name. */
const PRODUCT_MENTION = /fillbook/i;

/**
 * Loads the active, versioned Brand Constitution and provides a mechanical
 * first-pass check against prohibited vocabulary/claims. This is a cheap
 * substring guard meant to run before the more expensive brand_guardian /
 * fact_checker review agents (Phase 6) — it catches the obvious cases for
 * free and never lets a prohibited phrase slip through purely because the
 * LLM reviewer had an off day.
 */
export class BrandConstitution {
  constructor(private repo: BrandConstitutionRepository) {}

  async getActiveRules(): Promise<BrandRule[]> {
    return (await this.repo.getActiveRules()).filter((r) => r.isActive);
  }

  async getRulesByType(ruleType: BrandRule["ruleType"]): Promise<BrandRule[]> {
    return (await this.getActiveRules()).filter((r) => r.ruleType === ruleType);
  }

  /**
   * Naive phrase-containment check against vocabulary_prohibited and
   * claim_prohibited rules. Deliberately simple (no semantic matching) —
   * it flags a rule if any of a small set of known trigger phrases baked
   * into that rule's content appears in the candidate text. Real
   * brand-guardian scoring (an LLM review agent) is the primary check;
   * this exists as a fast, free, always-on backstop.
   *
   * Product-scoped rules (the tracking and coverage claims above) apply only when the candidate mentions Fillbook.
   * Matching ignores case, hyphens and extra whitespace, so "Real-time", "real  time" and "REAL TIME" are one phrase.
   */
  async checkVocabulary(candidateText: string): Promise<VocabularyViolation[]> {
    const rules = await this.getActiveRules();
    const tableContents = new Set(rules.map((r) => r.content));
    const prohibited = [
      ...rules.filter(
        (r) =>
          r.ruleType === "vocabulary_prohibited" ||
          r.ruleType === "claim_prohibited" ||
          r.ruleType === "disclosure_rule",
      ),
      // Built-in copies, unless the table already carries the same rule.
      ...BUILT_IN_CLAIM_RULES.filter((r) => !tableContents.has(r.content)),
    ];
    const normalized = normalizeForMatch(candidateText);
    const mentionsProduct = PRODUCT_MENTION.test(candidateText);
    const violations: VocabularyViolation[] = [];

    for (const rule of prohibited) {
      if (PRODUCT_SCOPED_RULE_CONTENTS.has(rule.content) && !mentionsProduct) continue;
      for (const phrase of extractTriggerPhrases(rule.content)) {
        if (containsPhrase(normalized, phrase)) {
          violations.push({ rule, matchedPhrase: phrase });
        }
      }
    }
    return violations;
  }
}

/** Lower-cases and collapses everything that is not a letter or digit to one space, so hyphens and spacing never hide a phrase. */
function normalizeForMatch(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Whole-word match on the normalized text. Only the verbs may carry a suffix ("guarantee" also catches "guaranteed", "never blow" catches "never blows"). */
function containsPhrase(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const suffix = /(?:guarantee|blow)$/.test(normalizedPhrase) ? "\\w*" : "";
  return new RegExp(`(?:^|\\s)${normalizedPhrase.replace(/ /g, "\\s+")}${suffix}(?:\\s|$)`).test(normalizedText);
}

/**
 * Extracts short literal trigger phrases hard-coded per known rule shape.
 * Not a general NLP extractor — brand_rules content is prose, not a
 * structured phrase list, so this maps specific seeded rules to the exact
 * phrases worth a mechanical check. Add a case here whenever a new
 * brand_rule is seeded with a concrete forbidden phrase.
 */
export function extractTriggerPhrases(ruleContent: string): string[] {
  const known: Record<string, string[]> = {
    "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.":
      ["I made this trade", "my trade today", "when I traded"],
    "Never assert an account is \"shadowbanned\" without evidence.": ["shadowbanned"],
    [BUILT_IN_CLAIM_RULES[0]!.content]: ["real time", "realtime", "live drawdown", "live tracking", "live alerts"],
    [BUILT_IN_CLAIM_RULES[1]!.content]: ["tracks every rule", "before a breach", "before you breach", "any broker"],
    [BUILT_IN_CLAIM_RULES[2]!.content]: ["never blow", "guarantee"],
  };
  return known[ruleContent] ?? [];
}
