/**
 * Originality Engine — token-overlap (Jaccard) similarity against recent
 * content. This is a lightweight, no-AI-call substitute for true semantic
 * (embedding) similarity; upgrade path is to swap this function's body
 * for an embedding-cosine comparison once an AI provider key exists for
 * this backend (see docs/ARCHITECTURE.md AI architecture section) without
 * changing the OriginalityEngine's public interface.
 */
export interface SimilarityResult {
  againstIndex: number;
  similarity: number; // 0-1
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class OriginalityEngine {
  /** Similarity of `candidate` against each of `recentTexts`, most-similar first. */
  compareAgainstRecent(candidate: string, recentTexts: string[]): SimilarityResult[] {
    const candidateTokens = tokenize(candidate);
    return recentTexts
      .map((text, againstIndex) => ({
        againstIndex,
        similarity: jaccard(candidateTokens, tokenize(text)),
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  /** True if the candidate is too similar to anything in recentTexts. */
  isTooSimilar(candidate: string, recentTexts: string[], threshold = 0.6): boolean {
    return this.compareAgainstRecent(candidate, recentTexts).some((r) => r.similarity >= threshold);
  }
}
