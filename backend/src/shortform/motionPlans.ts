import type { ScenePlan } from "./types.js";
import { PILOTS } from "./pilots.js";
import { PAYOFF_PILOTS } from "./payoffPilots.js";
import { STORY_PILOTS } from "./storyPilots.js";
import { MORE_STORY_PILOTS } from "./storyPilotsMore.js";
import { PILOT7_STORY_PILOTS } from "./storyPilots7.js";
import { MOCK_CARD_PILOTS } from "./chartMockConcepts.js";
import { OUTCOMES_PILOTS } from "./chartConcepts.js";
import { BARS_PILOTS } from "./chartBarsConcepts.js";

/**
 * Every verified ScenePlan a motion concept can be requested for: the original pilots plus the payoff redesign
 * variants. This is the single list both the catalog (scripts/video-factory/motionCatalog.ts, which the app's
 * "Create Fillbook Video" list and the render worker use) and the campaign pipeline (which drafts the script)
 * resolve a concept id against, so they can never disagree about what exists.
 */
export const MOTION_SCENE_PLANS: ScenePlan[] = [...PILOTS, ...PAYOFF_PILOTS, ...STORY_PILOTS, ...MORE_STORY_PILOTS, ...PILOT7_STORY_PILOTS, ...MOCK_CARD_PILOTS, ...BARS_PILOTS, ...OUTCOMES_PILOTS];

/**
 * True when this plan is a chart card (the "chart" layout). Since 2026-10-01 these are the only concepts the app offers
 * for a new video; every older concept stays resolvable so a script already drafted or approved still renders.
 */
export function isChartPlan(plan: ScenePlan): boolean {
  return plan.scenes.some((s) => s.layout === "chart");
}

/**
 * True when the app offers this plan for a new video: a chart card drawn as a product mock (chartMockConcepts.ts,
 * chartBarsConcepts.ts), which shows the Fillbook screen a figure comes from. The older drawn chart cards (the
 * illustrative win-rate family) stay resolvable, so a script already drafted or approved from one still renders, but they
 * are not offered again.
 */
export function isOfferedPlan(plan: ScenePlan): boolean {
  return plan.scenes.length > 0 && plan.scenes.every((s) => s.layout === "chart" && s.chart?.kind === "mock");
}

/** True when this plan uses the payoff layout and therefore needs the payoff render settings (voice rate, crossfade). */
export function isPayoffPlan(plan: ScenePlan): boolean {
  return plan.scenes.some((s) => s.layout === "payoff" || s.layout === "chart");
}
