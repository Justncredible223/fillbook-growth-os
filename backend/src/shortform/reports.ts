import { describeClaims } from "./claims.js";
import { TEXT_LIMITS, DEFAULT_FONT, estimateLines, fitCrop, layoutBoxes, platformsOf, rectsIntersect, safeRect } from "./layout.js";
import type { PlanIssue, PlanValidation, ScenePlan, SceneSpec, VerifiedAsset, VerifiedManifest } from "./types.js";

/**
 * Human-readable review reports for a scene plan. Pure functions of the plan, the manifest and the
 * validation result. They describe what the PLAN says; whether the pictures look right is a human's
 * call in the contact sheet, and nothing here claims otherwise.
 */

const WORDS_PER_SECOND_MAX = 3.3;
const WORDS_PER_SECOND_TARGET = 2.8;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

function assetOf(scene: SceneSpec, manifest: VerifiedManifest): VerifiedAsset | undefined {
  return scene.assetId ? manifest.assets.find((a) => a.id === scene.assetId) : undefined;
}

function md(cells: string[]): string {
  return `| ${cells.map((c) => c.replace(/\|/g, "/").replace(/\n/g, " ")).join(" | ")} |`;
}

function issuesFor(issues: PlanIssue[], sceneId: string, codes?: string[]): PlanIssue[] {
  return issues.filter((i) => i.sceneId === sceneId && (!codes || codes.includes(i.code)));
}

export interface TimelineRow {
  sceneId: string;
  start: number;
  end: number;
  seconds: number;
  words: number;
  wordsPerSecond: number;
  neededSeconds: number;
  transition: string;
}

export function buildTimeline(plan: ScenePlan): TimelineRow[] {
  let t = 0;
  return plan.scenes.map((s) => {
    const words = countWords(s.narration);
    const row: TimelineRow = {
      sceneId: s.sceneId,
      start: t,
      end: t + s.durationSeconds,
      seconds: s.durationSeconds,
      words,
      wordsPerSecond: words / s.durationSeconds,
      neededSeconds: words / WORDS_PER_SECOND_TARGET,
      transition: s.transition.type === "cut" ? "cut" : `fade ${s.transition.durationSeconds}s`,
    };
    t += s.durationSeconds;
    return row;
  });
}

export function buildTimingReport(plan: ScenePlan): string {
  const rows = buildTimeline(plan);
  const total = rows.reduce((s, r) => s + r.seconds, 0);
  const lines = [
    `# Scene timing: ${plan.title}`,
    "",
    `Total ${total.toFixed(1)}s (target at most ${TEXT_LIMITS.targetMaxSeconds}s, hard limit ${TEXT_LIMITS.maxSeconds}s). Narration pace is checked at ${WORDS_PER_SECOND_MAX} words/second; ${WORDS_PER_SECOND_TARGET} is the comfortable target for the voice.`,
    "",
    md(["Scene", "Start", "End", "Seconds", "Words", "Words/s", "Needs at least", "Transition", "Check"]),
    md(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const r of rows) {
    const tooFast = r.wordsPerSecond > WORDS_PER_SECOND_MAX;
    lines.push(md([r.sceneId, r.start.toFixed(1), r.end.toFixed(1), r.seconds.toFixed(1), String(r.words), r.wordsPerSecond.toFixed(2), `${r.neededSeconds.toFixed(1)}s`, r.transition, tooFast ? "TOO FAST for the narration" : "ok"]));
  }
  const fast = rows.filter((r) => r.wordsPerSecond > WORDS_PER_SECOND_MAX);
  lines.push("", fast.length ? `**${fast.length} scene(s) have more narration than their duration allows.** Lengthen the scene or shorten the line.` : "Every scene has enough time for its narration at the target pace.");
  lines.push("", "The first scene's first second is what a viewer sees before deciding to stay. Confirm in the preview that it is a concrete, readable visual.");
  return lines.join("\n");
}

const REVIEW_ONLY_CODES = ["asset_not_owner_verified", "crop_soft", "spelled_number_unchecked"];

export function buildClaimsReport(plan: ScenePlan, manifest: VerifiedManifest, validation: PlanValidation): string {
  const out: string[] = [`# Claims and evidence: ${plan.title}`, ""];
  const claimErrors = validation.issues.filter((i) => i.severity === "error" && /claim|evidence|statistic|guarantee|profit|payout|breach|replaces|warning|customer|personal_story|flag_|behavior_flag|topic_mismatch|demo_label/.test(i.code));

  out.push("## Unsupported or unverified claims (must be resolved or accepted before any render)", "");
  const unsupported: string[] = [];
  for (const issue of claimErrors) unsupported.push(`- **${issue.code}**${issue.sceneId ? ` (${issue.sceneId})` : ""}: ${issue.message}`);
  for (const m of validation.missingAssets) unsupported.push(`- **missing_asset**: "${m.id}" does not exist. Claims that depend on it cannot be checked: ${m.mustShow.join(", ")}.`);
  const unverifiedAssets = [...new Set(plan.scenes.map((s) => assetOf(s, manifest)).filter((a): a is VerifiedAsset => Boolean(a && !a.verifiedByOwner)).map((a) => a.id))];
  for (const id of unverifiedAssets) unsupported.push(`- **not_owner_verified**: the facts and regions recorded for ${id} were read from the screenshot by the system and have not been confirmed by the owner.`);
  out.push(unsupported.length ? unsupported.join("\n") : "None found by the automatic checks.", "");

  out.push("## Every claim, with the visual that backs it", "");
  for (const scene of plan.scenes) {
    const asset = assetOf(scene, manifest);
    out.push(`### ${scene.sceneId}`, "", `Narration: "${scene.narration}"`, `Takeaway: ${scene.takeaway}`, `Screenshot: ${scene.assetId ?? "none (text card)"}${asset && !asset.verifiedByOwner ? " (not yet owner-verified)" : ""}`, "");
    if (scene.claims.length === 0) out.push("_No claims declared._", "");
    for (const { claim, facts } of describeClaims(scene, asset)) {
      out.push(`- [${claim.type}] ${claim.text}`);
      if (facts.length) for (const f of facts) out.push(`  - evidence: ${f}`);
      else out.push(`  - evidence: ${claim.type === "concept" || claim.type === "invitation" ? "none needed" : "**NONE**"}`);
    }
    const sceneIssues = issuesFor(validation.issues, scene.sceneId).filter((i) => !REVIEW_ONLY_CODES.includes(i.code) && (i.severity === "error" || i.code.includes("claim")));
    for (const i of sceneIssues) out.push(`  - ${i.severity.toUpperCase()} ${i.code}: ${i.message}`);
    out.push("");
  }
  return out.join("\n");
}

export function buildPrivacyReport(plan: ScenePlan, manifest: VerifiedManifest, validation: PlanValidation): string {
  const out = [`# Privacy and redaction: ${plan.title}`, "", md(["Scene", "Screenshot", "Private regions in crop", "Masks placed", "Text has identifier", "Status"]), md(["---", "---", "---", "---", "---", "---"])];
  for (const scene of plan.scenes) {
    const asset = assetOf(scene, manifest);
    if (!asset) {
      out.push(md([scene.sceneId, scene.assetId ?? "text card", "n/a", String(scene.masks.length), "no", scene.assetId ? "asset missing, cannot check" : "ok"]));
      continue;
    }
    const inCrop = scene.crop ? asset.privateRegions.filter((p) => rectsIntersect(scene.crop!, p.region)) : [];
    const unmasked = issuesFor(validation.issues, scene.sceneId, ["unmasked_private_region"]);
    const textId = issuesFor(validation.issues, scene.sceneId, ["personal_identifier_in_text"]).length > 0;
    out.push(md([scene.sceneId, asset.id, String(inCrop.length), String(scene.masks.length), textId ? "YES" : "no", unmasked.length || textId ? "FAIL" : "ok"]));
  }
  const registered = manifest.assets.reduce((n, a) => n + a.privateRegions.length, 0);
  out.push(
    "",
    registered === 0
      ? "**No private regions are registered for any asset.** The screenshots are from a seeded demo account and are recorded as containing no emails or personal identifiers, but that record came from the system reading the images. The owner must confirm on the contact sheet that no email, name or account id is visible in any crop."
      : `${registered} private region(s) are registered; every one that a crop reveals must be masked (checked above).`,
  );
  return out.join("\n");
}

export function buildCropReport(plan: ScenePlan, manifest: VerifiedManifest, validation: PlanValidation): string {
  const out = [`# Crop and safe-area: ${plan.title}`, "", "Canvas 1080x1920. Text sits in fixed boxes inside each platform's safe area; screenshots are scaled uniformly (never stretched) into the media box.", ""];
  for (const platform of ["tiktok", "youtube_shorts"] as const) {
    const safe = safeRect(platform);
    const boxes = layoutBoxes(platform);
    out.push(`- ${platform}: safe area x ${safe.x}-${safe.x + safe.w}, y ${safe.y}-${safe.y + safe.h}; media box ${boxes.media.w}x${boxes.media.h} at (${boxes.media.x}, ${boxes.media.y})`);
  }
  out.push("", md(["Scene", "Crop (x,y,w,h)", "Source", "Scale (tiktok)", "Placed size", "Headline lines", "Caption lines", "Findings"]), md(["---", "---", "---", "---", "---", "---", "---", "---"]));
  for (const scene of plan.scenes) {
    const asset = assetOf(scene, manifest);
    const boxes = layoutBoxes("tiktok");
    const hl = estimateLines(scene.headline, scene.fontSizes?.headline ?? DEFAULT_FONT.headline, boxes.headline.w).lines;
    const cl = estimateLines(scene.captionText, scene.fontSizes?.caption ?? DEFAULT_FONT.caption, boxes.caption.w).lines;
    const findings = issuesFor(validation.issues, scene.sceneId).filter((i) => /crop|focal|chrome|sidebar|overflow|font|too_long|blurry|soft|stretch|dimension|missing_asset/.test(i.code));
    if (scene.crop && asset) {
      const fit = fitCrop(scene.crop, boxes.media);
      out.push(md([scene.sceneId, `${scene.crop.x},${scene.crop.y},${scene.crop.w},${scene.crop.h}`, `${asset.width}x${asset.height}`, fit.scale.toFixed(2), `${Math.round(fit.width)}x${Math.round(fit.height)}`, String(hl), String(cl), findings.length ? findings.map((f) => f.code).join(", ") : "ok"]));
    } else {
      out.push(md([scene.sceneId, scene.assetId ? "(asset missing)" : "text card", asset ? `${asset.width}x${asset.height}` : "-", "-", "-", String(hl), String(cl), findings.length ? findings.map((f) => f.code).join(", ") : "ok"]));
    }
  }
  out.push("", `Platforms per scene: ${[...new Set(plan.scenes.flatMap((s) => platformsOf(s.platform)))].join(", ")}. Limits: headline ${TEXT_LIMITS.headlineChars} chars, on-screen caption ${TEXT_LIMITS.captionChars} chars, minimum font sizes enforced.`);
  out.push("", "A crop that is inside the image and passes these checks can still look wrong. Look at the contact sheet and the safe-area sheet.");
  return out.join("\n");
}

/** One-page summary used at the top of a plan's output folder. */
export function buildPlanSummary(plan: ScenePlan, validation: PlanValidation): string {
  const errors = validation.issues.filter((i) => i.severity === "error");
  const review = validation.issues.filter((i) => i.severity === "review");
  const status = validation.blockedByMissingAssets ? "BLOCKED: missing source asset(s)" : errors.length ? "NOT READY: validation errors" : "Structurally valid. NOT visually approved.";
  const out = [`# ${plan.title}`, "", `Series: ${plan.series}`, `Experiment ${plan.experimentId} / variation ${plan.variationId}`, `Status: **${status}**`, ""];
  if (validation.missingAssets.length) {
    out.push("## Missing source assets (nothing was invented to fill these)", "");
    for (const m of validation.missingAssets) out.push(`- **${m.id}**: ${m.description}`, `  - must show: ${m.mustShow.join(", ")}`);
    out.push("");
  }
  out.push(`## Errors (${errors.length})`, "", ...(errors.length ? errors.map((i) => `- ${i.code}${i.sceneId ? ` (${i.sceneId})` : ""}: ${i.message}`) : ["None."]), "", `## For human review (${review.length})`, "", ...(review.length ? review.map((i) => `- ${i.code}${i.sceneId ? ` (${i.sceneId})` : ""}: ${i.message}`) : ["None."]));
  return out.join("\n");
}
