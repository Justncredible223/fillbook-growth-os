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
import { PILOT_1, PILOT_2, PILOT_3, PILOT_1_OPENING_B, PILOT_2_OPENING_B, PILOT_3_OPENING_C, pilotMetadata } from "../../src/shortform/pilots.js";
import { validatePublishedMetadata, emptyMetrics, serializeMetrics, serializeMetricsCsv, serializeMetadata } from "../../src/shortform/metadata.js";
import type { ScenePlan } from "../../src/shortform/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "..", "..", "out", "shortform-evidence-2026-09-26");
mkdirSync(OUT, { recursive: true });

// Concept A = Plan vs Execution (PILOT_3): v1 = base (hook "Same setup. Bigger size." -- a
//   direct statement), v2 = PILOT_3_OPENING_C (hook "Your plan has a size limit. This trade used
//   5 contracts." -- a concrete comparison).
// Concept B = Green Month, Losing Setup (PILOT_1): v1 = base (hook "Green month. Losing setup."
//   -- direct statement), v2 = PILOT_1_OPENING_B (hook "64% win rate. One setup still loses." --
//   a concrete comparison).
// Concept C = Profit vs Remaining Buffer (PILOT_2): v1 = base (hook "Balance isn't your buffer."
//   -- direct statement), v2 = PILOT_2_OPENING_B (hook "You're up. How much room is left?" -- a
//   literal question).
// Each v2 is built by openingOnlyVariant() (src/shortform/pilots.ts), NOT the pre-existing
// angleOf()-based PILOT_ANGLES -- angleOf rewrites every scene's wording for a full alternate
// angle, which would confound "did the opening change retention" with "did the whole video
// change." openingOnlyVariant swaps ONLY scene 0's narration/headline/caption/takeaway and
// leaves scenes 2-4 byte-identical to the base plan (same narration -> same real-TTS timing),
// so evidence sequence, voice, duration-after-opening, caption style and CTA are structurally
// guaranteed identical between v1 and v2, not just identical by convention.
const PAIRS: Array<{ concept: string; v1: ScenePlan; v2: ScenePlan }> = [
  { concept: "A_plan_vs_execution", v1: PILOT_3, v2: PILOT_3_OPENING_C },
  { concept: "B_green_month_losing_setup", v1: PILOT_1, v2: PILOT_1_OPENING_B },
  { concept: "C_profit_vs_buffer", v1: PILOT_2, v2: PILOT_2_OPENING_B },
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
