import { rectContains } from "./layout.js";
import type { Claim, ClaimType, PlanIssue, SceneSpec, VerifiedAsset } from "./types.js";

/** Claim types that assert something about the product or the data on screen, so they need a visual source. */
const EVIDENCE_TYPES: ReadonlySet<ClaimType> = new Set(["product_capability", "data_point", "behavior_flag"]);

interface Banned {
  code: string;
  pattern: RegExp;
  message: string;
  severity?: "error" | "review";
}

/**
 * Things a Fillbook short must never say, however the sentence is worded. Deterministic and
 * intentionally blunt: a false positive costs a rewrite, a false negative costs trust.
 */
const BANNED: Banned[] = [
  { code: "guarantee_language", pattern: /\bguarante(?:e|ed|es|eing)\b/i, message: "Never promise or guarantee anything." },
  {
    code: "profit_promise",
    pattern: /\b(?:make|makes|making|turn|turns)\s+you\s+(?:profitable|funded|rich|consistent)\b|\bbecome\s+(?:a\s+)?profitable\b|\bmore\s+profits?\b|\bgrow\s+your\s+(?:account|profits?)\b|\bhelps?\s+you\s+(?:profit|win|get funded)\b/i,
    message: "Do not promise or imply profit.",
  },
  {
    code: "payout_promise",
    pattern: /\b(?:get|gets|getting|secure|secures)\s+(?:you\s+)?(?:your\s+)?(?:paid|payouts?)\b|\bpayouts?\s+(?:guaranteed|secured|assured)\b|\b(?:helps?|lets?)\s+you\s+pass\s+(?:the\s+|your\s+)?(?:eval|evaluation|challenge)\b/i,
    message: "Do not promise payouts or passing an evaluation.",
  },
  {
    code: "breach_prevention",
    pattern: /\b(?:prevent|prevents|preventing|stop|stops|avoid|avoids|protect|protects|save|saves)\b[^.!?]{0,40}\b(?:breach(?:es)?|blow(?:ing)?\s+(?:up|an\s+account)|blown\s+accounts?|account\s+(?:loss|failure))\b|\bnever\s+(?:breach|blow)\b|\bkeeps?\s+(?:your|the)\s+account\s+(?:safe|alive)\b/i,
    message: "Do not claim Fillbook prevents account breaches or blown accounts.",
  },
  {
    code: "replaces_risk_system",
    pattern: /\b(?:replace|replaces|replaced|instead\s+of|no\s+need\s+for|better\s+than|as\s+good\s+as)\b[^.!?]{0,40}\b(?:broker|prop[- ]?firm|rule\s?book|risk\s+(?:system|engine|manager)|dashboard)\b|\b(?:live|real[- ]?time)\s+(?:risk|drawdown|account)\s+(?:monitor(?:ing)?|protection|alerts?)\b/i,
    message: "Fillbook does not replace a broker or a prop firm's risk system, and is not a live risk monitor.",
  },
  {
    code: "timely_warning_promise",
    pattern: /\b(?:warn|warns|alert|alerts|notify|notifies)\s+you\s+(?:before|in\s+time|instantly|immediately|the\s+moment)\b/i,
    message: "Do not promise timely warnings.",
  },
  {
    code: "fabricated_customer_outcome",
    pattern: /\b(?:our|fillbook'?s?)\s+(?:users|customers|members|traders)\b[^.!?]{0,60}\b(?:saved|improved|increased|reduced|grew|made|earned|passed|kept)\b|\b(?:customers?|users?|members?)\s+(?:report|reported|saw|got|earned|passed)\b|\b(?:testimonials?|success\s+stor(?:y|ies))\b/i,
    message: "No customer outcomes: none are verified.",
  },
  {
    code: "unsupported_statistic",
    pattern: /\b(?:most|many|the\s+majority\s+of)\s+(?:funded\s+|prop\s+)?traders\b|\b\d{1,3}\s?%\s+of\s+(?:funded\s+|prop\s+)?traders\b|\bstud(?:y|ies)\s+(?:show|shows|found)\b|\bresearch\s+(?:shows|proves)\b/i,
    message: "No statistics about traders in general: none are verified.",
  },
  {
    code: "invented_personal_story",
    pattern: /\b(?:i|i'm|i've|i'd)\s+(?:blew|blown|lost|failed|passed|wiped|got\s+funded|traded|made|used\s+to|was)\b|\bmy\s+(?:funded\s+|trading\s+)?(?:account|evaluation|eval|trades?|losses|drawdown|journey|story)\b|\bwhen\s+i\b/i,
    message: "No first-person trading stories: the account speaks for a product, not a trader.",
  },
  {
    code: "flag_proves_intent",
    pattern: /\b(?:proves?|proving|confirms?)\s+(?:that\s+)?(?:you|the\s+trader|they)\b|\byou\s+(?:were|are)\s+(?:tilting|on\s+tilt|revenge\s+trading|gambling|emotional|panicking)\b|\bbecause\s+you\s+(?:felt|were|wanted|panicked|got\s+angry|got\s+emotional)\b|\byou\s+(?:wanted|felt|intended)\s+to\b/i,
    message: "A behavior flag never proves what a trader intended or felt.",
  },
  {
    code: "flag_as_diagnosis",
    pattern: /(?<!\bnot\s)(?<!\bnot\sa\s)(?<!\bnever\sa\s)\bdiagnos(?:e|es|ed|is|ing)\b|\bdetects?\s+(?:your\s+)?(?:tilt|emotions?|psychology|intent)\b|\byou\s+(?:revenge[- ]traded|over-?traded|tilted)\b/i,
    message: "A behavior flag is a review prompt, not a diagnosis.",
  },
];

/** Behavior labels Fillbook can attach to a trade. Mentioning one requires review-prompt framing. */
const BEHAVIOR_TERMS = /\b(?:revenge|oversized|over-?sized|tilt|fomo|over-?trad\w*|impulsive)\b/i;
/** Words that frame the label as a flag or a prompt to review rather than a verdict. */
const FLAG_FRAMING = /\b(?:flag|flags|flagged|tag|tagged|possible|possibly|may|might|review prompt|prompt|worth (?:a )?(?:review|reviewing|a look)|review)\b/i;

const NUMBER_RE = /-?\$?\d[\d,]*(?:\.\d+)?(?:%|R)?/g;
const SPELLED_NUMBER_RE = /\b(?:percent|thousand|hundred|million)\b/i;

export function extractNumbers(text: string): string[] {
  return text.match(NUMBER_RE) ?? [];
}

function parseNumber(token: string): { value: number; decimals: number } | null {
  const cleaned = token.replace(/[$,%R]/g, "").replace(/^-/, "");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const decimals = cleaned.includes(".") ? cleaned.split(".")[1]!.length : 0;
  return { value: Number(cleaned), decimals };
}

/** A number in a scene is supported when it equals a displayed number, or is that number rounded to fewer decimals. Sign and units are ignored on purpose. */
export function numberIsSupported(token: string, displayedTokens: string[]): boolean {
  const n = parseNumber(token);
  if (!n) return true;
  return displayedTokens.some((shown) => {
    const f = parseNumber(shown);
    if (!f) return false;
    if (f.value === n.value) return true;
    if (n.decimals < f.decimals) {
      const factor = 10 ** n.decimals;
      const rounded = Math.round(f.value * factor) / factor;
      const truncated = Math.floor(f.value * factor) / factor;
      return n.value === rounded || n.value === truncated;
    }
    return false;
  });
}

/** Scans one piece of viewer-facing text for banned claims and unsafe behavior-flag wording. */
export function scanText(text: string, field: string, sceneId?: string): PlanIssue[] {
  const issues: PlanIssue[] = [];
  for (const rule of BANNED) {
    if (rule.pattern.test(text)) {
      issues.push({ severity: rule.severity ?? "error", code: rule.code, sceneId, message: `${field}: ${rule.message}` });
    }
  }
  if (BEHAVIOR_TERMS.test(text) && !FLAG_FRAMING.test(text)) {
    issues.push({
      severity: "error",
      code: "behavior_flag_not_framed_as_prompt",
      sceneId,
      message: `${field}: a behavior label must be described as a flag or review prompt (say "flagged", "possible", or "worth reviewing"), never stated as fact.`,
    });
  }
  return issues;
}

function claimEvidenceNumbers(scene: SceneSpec, asset: VerifiedAsset): string[] {
  const numbers: string[] = [];
  for (const claim of scene.claims) {
    for (const ev of claim.evidence) {
      const fact = asset.facts.find((f) => f.key === ev.factKey);
      if (!fact) continue;
      numbers.push(...fact.values, ...extractNumbers(fact.text));
    }
  }
  return numbers;
}

/**
 * Claim-to-visual validation for one scene. Every spoken or shown product claim must:
 * point at a fact in the SAME scene's asset, have that fact's region inside the crop the
 * viewer sees, match the scene's topic, and use only numbers that are displayed in that fact.
 */
export function validateSceneClaims(scene: SceneSpec, asset: VerifiedAsset | undefined): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (severity: PlanIssue["severity"], code: string, message: string) => issues.push({ severity, code, sceneId: scene.sceneId, message });

  const visibleText = [
    ["narration", scene.narration],
    ["headline", scene.headline],
    ["caption", scene.captionText],
    ["disclosure", scene.disclosure ?? ""],
    ["cta", scene.cta ?? ""],
    ["takeaway", scene.takeaway],
  ] as const;
  for (const [field, text] of visibleText) if (text) issues.push(...scanText(text, `Scene ${scene.sceneId} ${field}`, scene.sceneId));

  const spokenAndShown = `${scene.narration} ${scene.headline} ${scene.captionText}`;
  const mentionsProduct = /\bfillbook\b|\b(?:the|this|your)\s+(?:trade\s+log|app|dashboard)\b/i.test(scene.narration);
  const evidenceClaims = scene.claims.filter((c) => EVIDENCE_TYPES.has(c.type));

  for (const claim of evidenceClaims) {
    if (claim.evidence.length === 0) add("error", "claim_without_visual_source", `Claim "${claim.id}" (${claim.type}) has no verified visual source.`);
  }

  if (!scene.assetId || !asset) {
    if (mentionsProduct || evidenceClaims.length > 0) {
      add("error", "product_claim_without_visual", "This scene makes a product claim but has no verified asset on screen.");
    }
    return issues;
  }

  if (evidenceClaims.length === 0) {
    add("error", "scene_without_evidence_claim", "A screenshot scene must declare at least one claim that its narration makes about what is on screen.");
  }

  const topicsOverlap = scene.expectedTopics.some((t) => asset.topics.includes(t));
  if (!topicsOverlap) {
    add("error", "narration_asset_topic_mismatch", `The scene is about [${scene.expectedTopics.join(", ")}] but its screenshot shows [${asset.topics.join(", ")}].`);
  }

  for (const claim of evidenceClaims) {
    for (const ev of claim.evidence) {
      if (ev.assetId !== scene.assetId) {
        add("error", "evidence_wrong_asset", `Claim "${claim.id}" cites ${ev.assetId}, but this scene shows ${scene.assetId}.`);
        continue;
      }
      const fact = asset.facts.find((f) => f.key === ev.factKey);
      if (!fact) {
        add("error", "evidence_fact_unknown", `Claim "${claim.id}" cites fact "${ev.factKey}", which is not in the manifest for ${asset.id}.`);
        continue;
      }
      if (scene.crop && !rectContains(scene.crop, fact.region, 2)) {
        add("error", "evidence_not_visible", `Claim "${claim.id}" cites "${ev.factKey}", but that part of the screenshot is cropped out of this scene.`);
      }
      if (!scene.expectedTopics.some((t) => fact.topics.includes(t))) {
        add("error", "narration_fact_topic_mismatch", `Claim "${claim.id}" cites "${ev.factKey}" (${fact.topics.join(", ")}), which is not about [${scene.expectedTopics.join(", ")}].`);
      }
    }
  }

  const displayed = claimEvidenceNumbers(scene, asset);
  const seen = new Set<string>();
  for (const token of extractNumbers(spokenAndShown)) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (!numberIsSupported(token, displayed)) {
      add("error", "unsupported_statistic", `The number "${token}" is spoken or shown but does not appear in any fact this scene cites.`);
    }
  }
  if (SPELLED_NUMBER_RE.test(spokenAndShown)) {
    add("review", "spelled_number_unchecked", "A number is spelled out in words; write numbers as digits so they can be checked against the screenshot.");
  }
  return issues;
}

/** Convenience for reports: every claim in a scene with its resolved evidence facts. */
export function describeClaims(scene: SceneSpec, asset: VerifiedAsset | undefined): Array<{ claim: Claim; facts: string[] }> {
  return scene.claims.map((claim) => ({
    claim,
    facts: claim.evidence.map((ev) => {
      const fact = asset?.facts.find((f) => f.key === ev.factKey);
      return fact ? `${ev.factKey}: ${fact.text}` : `${ev.factKey}: NOT FOUND`;
    }),
  }));
}
