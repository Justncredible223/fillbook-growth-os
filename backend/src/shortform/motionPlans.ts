import type { ScenePlan } from "./types.js";
import { PILOTS } from "./pilots.js";
import { PAYOFF_PILOTS } from "./payoffPilots.js";

/**
 * Every verified ScenePlan a motion concept can be requested for: the original pilots plus the payoff redesign
 * variants. This is the single list both the catalog (scripts/video-factory/motionCatalog.ts, which the app's
 * "Create Fillbook Video" list and the render worker use) and the campaign pipeline (which drafts the script)
 * resolve a concept id against, so they can never disagree about what exists.
 */
export const MOTION_SCENE_PLANS: ScenePlan[] = [...PILOTS, ...PAYOFF_PILOTS];

/** True when this plan uses the payoff layout and therefore needs the payoff render settings (voice rate, crossfade). */
export function isPayoffPlan(plan: ScenePlan): boolean {
  return plan.scenes.some((s) => s.layout === "payoff");
}
