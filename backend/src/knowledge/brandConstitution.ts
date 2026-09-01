import type { BrandConstitutionRepository, BrandRule } from "./types.js";

export interface VocabularyViolation {
  rule: BrandRule;
  matchedPhrase: string;
}

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
   */
  async checkVocabulary(candidateText: string): Promise<VocabularyViolation[]> {
    const rules = await this.getActiveRules();
    const prohibited = rules.filter(
      (r) =>
        r.ruleType === "vocabulary_prohibited" ||
        r.ruleType === "claim_prohibited" ||
        r.ruleType === "disclosure_rule",
    );
    const lowerText = candidateText.toLowerCase();
    const violations: VocabularyViolation[] = [];

    for (const rule of prohibited) {
      for (const phrase of extractTriggerPhrases(rule.content)) {
        if (lowerText.includes(phrase.toLowerCase())) {
          violations.push({ rule, matchedPhrase: phrase });
        }
      }
    }
    return violations;
  }
}

/**
 * Extracts short literal trigger phrases hard-coded per known rule shape.
 * Not a general NLP extractor — brand_rules content is prose, not a
 * structured phrase list, so this maps specific seeded rules to the exact
 * phrases worth a mechanical check. Add a case here whenever a new
 * brand_rule is seeded with a concrete forbidden phrase.
 */
function extractTriggerPhrases(ruleContent: string): string[] {
  const known: Record<string, string[]> = {
    "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.":
      ["I made this trade", "my trade today", "when I traded"],
    "Never assert an account is \"shadowbanned\" without evidence.": ["shadowbanned"],
  };
  return known[ruleContent] ?? [];
}
