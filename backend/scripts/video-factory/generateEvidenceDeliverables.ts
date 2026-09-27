#!/usr/bin/env node
/**
 * Local-only helper for the 2026-09-26 shortform evidence pass. Generates, through the
 * REAL production metadata system (src/shortform/metadata.ts + pilots.ts's pilotMetadata),
 * separate TikTok/YouTube metadata files for the six opening-variant previews (concepts
 * A/B/C x variant 1/2 = PILOT_3/PILOT_3--b/c... see mapping below), plus an empty
 * measurement-sheet CSV template (via serializeMetricsCsv/emptyMetrics) for manual 24h/72h/7d
 * posting review. Writes nothing anywhere but local out/ (gitignored). No network calls.
 *
 *   npx tsx scripts/video-factory/generateEvidenceDeliverables.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PILOT_1, PILOT_2, PILOT_3, PILOT_ANGLES, pilotMetadata } from "../../src/shortform/pilots.js";
import { validatePublishedMetadata, emptyMetrics, serializeMetrics, serializeMetricsCsv, serializeMetadata } from "../../src/shortform/metadata.js";
import type { ScenePlan } from "../../src/shortform/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "..", "..", "out", "shortform-evidence-2026-09-26");
mkdirSync(OUT, { recursive: true });

function findAngle(basePlanId: string, key: string): ScenePlan {
  const plan = PILOT_ANGLES.find((p) => p.planId === `${basePlanId}--${key}`);
  if (!plan) throw new Error(`Angle ${basePlanId}--${key} not found`);
  return plan;
}

// Concept A = Plan vs Execution (PILOT_3): variant 1 = base (direct statement hook),
// variant 2 = "--c" angle (a concrete question/comparison hook, same evidence/voice/CTA).
// Concept B = Green Month, Losing Setup (PILOT_1): variant 1 = base, variant 2 = "--c" angle.
// Concept C = Profit vs Remaining Buffer (PILOT_2): variant 1 = base, variant 2 = "--c" angle.
// (The "--b" angles exist too and are additional direct-statement alternates; "--c" was chosen
// for variant 2 in each pair because its hook is phrased as a question/comparison, matching the
// task's variant-2 definition, while "--b" is a second direct statement in two of the three
// pairs. This choice is documented here rather than silently made.)
const PAIRS: Array<{ concept: string; v1: ScenePlan; v2: ScenePlan }> = [
  { concept: "A_plan_vs_execution", v1: PILOT_3, v2: findAngle(PILOT_3.planId, "c") },
  { concept: "B_green_month_losing_setup", v1: PILOT_1, v2: findAngle(PILOT_1.planId, "c") },
  { concept: "C_profit_vs_buffer", v1: PILOT_2, v2: findAngle(PILOT_2.planId, "c") },
];

const allIssues: string[] = [];
for (const { concept, v1, v2 } of PAIRS) {
  for (const [variant, plan] of [["v1", v1], ["v2", v2]] as const) {
    for (const platform of ["tiktok", "youtube_shorts"] as const) {
      const meta = pilotMetadata(plan, platform);
      const issues = validatePublishedMetadata(meta);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length) allIssues.push(`${concept}/${variant}/${platform}: ${errors.map((e) => e.message).join("; ")}`);
      const filename = `${concept}--${variant}--${platform}.json`;
      writeFileSync(join(OUT, filename), serializeMetadata(meta), "utf8");
    }
  }
}

// Measurement sheet: one blank (all-null) row per platform per preview, ready for manual
// 24h/72h/7d entry. Uses the real PlatformMetrics shape so a filled-in copy round-trips
// through parseMetricsCsv/serializeMetricsCsv unchanged.
const rows: Array<{ platform: "tiktok" | "youtube_shorts"; experimentId: string; variationId: string; metrics: ReturnType<typeof emptyMetrics> }> = [];
for (const { v1, v2 } of PAIRS) {
  for (const plan of [v1, v2]) {
    for (const platform of ["tiktok", "youtube_shorts"] as const) {
      for (const checkpoint of ["24h", "72h", "7d"] as const) {
        rows.push({
          platform,
          experimentId: plan.experimentId,
          variationId: `${plan.variationId}__${checkpoint}`,
          metrics: emptyMetrics("", "manual"),
        });
      }
    }
  }
}
writeFileSync(join(OUT, "measurement-sheet-template.csv"), serializeMetricsCsv(rows), "utf8");

console.log(`Wrote ${PAIRS.length * 2 * 2} metadata files and 1 measurement-sheet template to ${OUT}`);
if (allIssues.length) {
  console.log("\nMetadata validation errors (must fix before any real posting):");
  for (const issue of allIssues) console.log(` - ${issue}`);
  process.exitCode = 1;
} else {
  console.log("All 12 metadata records passed validatePublishedMetadata (no errors).");
}
