#!/usr/bin/env node
/**
 * Ranks every motion concept by the story scorecard (src/shortform/storyScore.ts): which concepts are worth rendering?
 *
 *   npx tsx scripts/video-factory/_scorePilots.ts [top-N] [--detail=<planId fragment>]
 */
import { MOTION_SCENE_PLANS } from "../../src/shortform/motionPlans.js";
import { scoreStory } from "../../src/shortform/storyScore.js";

const topN = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 12);
const detail = process.argv.find((a) => a.startsWith("--detail="))?.slice("--detail=".length);

const scored = MOTION_SCENE_PLANS.map((p) => ({ plan: p, s: scoreStory(p) })).sort((a, b) => b.s.score - a.s.score);
const dist: Record<string, number> = {};
for (const { s } of scored) dist[s.grade] = (dist[s.grade] ?? 0) + 1;
console.log(`Scored ${scored.length} concepts: ${Object.entries(dist).map(([g, n]) => `${g}=${n}`).join("  ")}\n`);

const line = ({ plan, s }: (typeof scored)[number]) => `${String(s.score).padStart(3)} ${s.grade.padEnd(2)}  ${plan.planId.padEnd(46)} ${plan.hook.slice(0, 64)}`;
console.log(`TOP ${topN}`);
for (const r of scored.slice(0, topN)) console.log(line(r));
console.log("\nBOTTOM 6");
for (const r of scored.slice(-6)) console.log(line(r));

if (detail) {
  for (const r of scored.filter((x) => x.plan.planId.includes(detail))) {
    console.log(`\n=== ${r.plan.planId}: ${r.s.score} (${r.s.grade}) — "${r.plan.hook}"`);
    for (const c of r.s.criteria) console.log(`  ${String(c.points).padStart(2)}/${String(c.max).padEnd(2)} ${c.label} — ${c.note}`);
  }
}
