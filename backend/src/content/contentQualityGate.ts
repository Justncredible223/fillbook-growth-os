import { BrandConstitution, type VocabularyViolation } from "../knowledge/brandConstitution";
import { checkAntiSlop, type SlopFinding } from "./antiSlopEngine";
import { OriginalityEngine } from "./originalityEngine";

export interface QualityGateResult {
  passed: boolean;
  vocabularyViolations: VocabularyViolation[];
  slopFindings: SlopFinding[];
  maxSimilarity: number;
  blockReasons: string[];
}

const ORIGINALITY_THRESHOLD = 0.6;

/**
 * Combines the mechanical checks (brand vocabulary, anti-slop, originality)
 * into a single pass/fail gate that content must clear before advancing
 * past 'anti_slop_review'/'originality_review' stages in the Campaign
 * Factory pipeline. This does NOT replace the LLM review agents (trader,
 * hook_specialist, brand_guardian, etc. — Phase 6 deep review, gated on an
 * AI provider key) — it's the cheap, always-on backstop that runs first.
 */
export class ContentQualityGate {
  private originality = new OriginalityEngine();

  constructor(private brandConstitution: BrandConstitution) {}

  async check(candidateText: string, recentTextsForSameTopic: string[]): Promise<QualityGateResult> {
    const vocabularyViolations = await this.brandConstitution.checkVocabulary(candidateText);
    const slopFindings = checkAntiSlop(candidateText);
    const similarities = this.originality.compareAgainstRecent(candidateText, recentTextsForSameTopic);
    const maxSimilarity = similarities[0]?.similarity ?? 0;

    const blockReasons: string[] = [];
    if (vocabularyViolations.length > 0) {
      blockReasons.push(`${vocabularyViolations.length} brand vocabulary/claim violation(s)`);
    }
    if (slopFindings.length > 0) {
      blockReasons.push(`${slopFindings.length} anti-slop finding(s)`);
    }
    if (maxSimilarity >= ORIGINALITY_THRESHOLD) {
      blockReasons.push(`too similar to recent content (${(maxSimilarity * 100).toFixed(0)}% overlap)`);
    }

    return {
      passed: blockReasons.length === 0,
      vocabularyViolations,
      slopFindings,
      maxSimilarity,
      blockReasons,
    };
  }
}
