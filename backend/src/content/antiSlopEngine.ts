/**
 * Anti-AI-Slop Engine — deterministic, no-AI-call heuristic pass. Runs
 * before (and independent of) any LLM-based review agent, so a slop
 * pattern is caught even if the model reviewer has an off day. See master
 * spec: "No post is better than a bad post."
 *
 * This is intentionally mechanical/regex-based rather than a model call —
 * it needs no AI provider key to run, unlike the deeper judgment-based
 * evaluators (trader/hook-specialist/brand-guardian) which are Phase 6+
 * work gated on an AI provider being configured (see docs/ARCHITECTURE.md).
 */
export interface SlopFinding {
  rule: string;
  detail: string;
}

const GENERIC_OPENERS = [
  /^in today'?s fast-paced/i,
  /^in the world of/i,
  /^let'?s dive in/i,
  /^have you ever wondered/i,
  /^picture this/i,
];

const AI_CLICHE_PHRASES = [
  "unlock your potential",
  "game changer",
  "game-changer",
  "take it to the next level",
  "in this day and age",
  "it's important to note that",
  "at the end of the day",
  "when it comes to",
];

const FAKE_URGENCY_PHRASES = [
  "don't miss out",
  "act now",
  "limited time",
  "last chance",
];

export function checkAntiSlop(text: string): SlopFinding[] {
  const findings: SlopFinding[] = [];
  const lower = text.toLowerCase();

  for (const pattern of GENERIC_OPENERS) {
    if (pattern.test(text.trim())) {
      findings.push({ rule: "generic_opener", detail: `matches ${pattern}` });
    }
  }

  for (const phrase of AI_CLICHE_PHRASES) {
    if (lower.includes(phrase)) {
      findings.push({ rule: "ai_cliche_phrase", detail: phrase });
    }
  }

  for (const phrase of FAKE_URGENCY_PHRASES) {
    if (lower.includes(phrase)) {
      findings.push({ rule: "fake_urgency", detail: phrase });
    }
  }

  const emDashCount = (text.match(/—/g) ?? []).length;
  if (emDashCount >= 6) {
    findings.push({ rule: "excessive_em_dashes", detail: `${emDashCount} em dashes` });
  }

  const rhetoricalQuestions = (text.match(/\?/g) ?? []).length;
  if (rhetoricalQuestions >= 3) {
    findings.push({ rule: "excessive_rhetorical_questions", detail: `${rhetoricalQuestions} question marks` });
  }

  const hashtagCount = (text.match(/#\w+/g) ?? []).length;
  if (hashtagCount >= 10) {
    findings.push({ rule: "hashtag_spam", detail: `${hashtagCount} hashtags` });
  }

  const emojiMatches = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  if (emojiMatches.length >= 6) {
    findings.push({ rule: "repetitive_emoji", detail: `${emojiMatches.length} emoji` });
  }

  return findings;
}

export function isClean(text: string): boolean {
  return checkAntiSlop(text).length === 0;
}
