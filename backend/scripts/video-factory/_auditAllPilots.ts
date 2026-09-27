/**
 * Library-wide audit helper (2026-09-27): runs validateScenePlan (claims.ts/layout.ts's full
 * claim-evidence/timing/framing checks) across every plan in PILOTS at once, grouped by issue
 * code, so a reviewer doesn't have to re-read each of the 57 plans by hand to find the same risk
 * classes already fixed in PILOT_1/2/3 (claim-before-evidence timing, wrong asset/region,
 * motive-diagnosis language, insufficient footage). Zero-error output here is necessary but not
 * sufficient: any review-severity flag (especially evidence_visible_late_in_clip_window and
 * motion_footage_margin_tight) still needs a real render + frame check before being trusted, since
 * the validator can't see actual rendered frames or fully model render.ts's transition-padding math.
 *
 *   npx tsx scripts/video-factory/_auditAllPilots.ts
 */
import { PILOTS } from "../../src/shortform/pilots.js";
import { loadManifest, validateScenePlan } from "../../src/shortform/scenePlan.js";

const manifest = loadManifest();
const byCode: Record<string, string[]> = {};
let errorCount = 0;
let reviewCount = 0;

for (const plan of PILOTS) {
  const v = validateScenePlan(plan, manifest, { checkFiles: true });
  for (const issue of v.issues) {
    const key = `${issue.severity}:${issue.code}`;
    (byCode[key] ??= []).push(`${plan.planId} [${issue.sceneId ?? "-"}]: ${issue.message}`);
    if (issue.severity === "error") errorCount++;
    else reviewCount++;
  }
  if (v.blockedByMissingAssets) {
    (byCode["error:blocked_by_missing_assets"] ??= []).push(`${plan.planId}: ${JSON.stringify(v.missingAssets)}`);
  }
}

console.log(`Audited ${PILOTS.length} pilots. ${errorCount} error-severity issues, ${reviewCount} review-severity issues.\n`);
for (const [code, lines] of Object.entries(byCode)) {
  console.log(`--- ${code} (${lines.length}) ---`);
  for (const l of lines) console.log(`  ${l}`);
  console.log("");
}
if (errorCount === 0 && reviewCount === 0) console.log("No issues at all.");
