import { listMotionConcepts } from "../../scripts/video-factory/motionCatalog.js";
import type { MotionConceptSummary } from "../../scripts/video-factory/motionCatalog.js";
import { manualMotionConceptTitle } from "../opportunities/manualMotionConcept.js";
import { MOTION_SCENE_PLANS, isChartPlan } from "../shortform/motionPlans.js";
import { renderBar } from "../shortform/storyScore.js";
import type { ScenePlan } from "../shortform/types.js";

/**
 * The daily chart-card refill: keeps a few chart cards waiting in Approvals so there is always something fresh to
 * approve, without the owner requesting each one. It only REQUESTS (queues a draft); approving, and so rendering,
 * stays the owner's action in the app. It is bounded three ways: never more than MAX_CHART_CARDS_WAITING waiting at
 * once (so a few days of not approving never piles up drafts or review spend), only concepts that are offered and clear
 * the render bar, and each concept only once (a used-up concept is never requested again).
 */
export const MAX_CHART_CARDS_WAITING = 3;
/** When fewer than this many unused chart concepts remain, the step report says so, so the supply is topped up in time. */
export const LOW_SUPPLY_AT = 4;

export type ConceptState = "made" | "waiting" | "rejected";

export interface DailyChartCardDeps {
  isPaused(): Promise<boolean>;
  /** Used-up and in-flight concepts, keyed by their opportunity title (see motionConceptStates in api/run-campaign.ts). */
  states(): Promise<Map<string, ConceptState>>;
  request(conceptId: string): Promise<{ campaignRunRequestId: string; opportunityId: string }>;
}

/** The theme a chart concept is about: its first scene's topic. Concepts about the same thing share one. */
function themeOf(plan: ScenePlan): string {
  return plan.scenes[0]?.expectedTopics[0] ?? plan.planId;
}

/**
 * The chart-card concepts the app offers, in the order they are requested. Round-robin across themes (the hand-made and
 * bar-chart concepts each cover a different part of the product; the illustrative win-rate ones are one theme of many
 * variations), so consecutive requests are about different things instead of the same template again and again.
 */
export function offeredChartConcepts(): MotionConceptSummary[] {
  const byId = new Map(MOTION_SCENE_PLANS.map((p) => [p.planId, p] as const));
  const offered = listMotionConcepts().filter((c) => {
    const plan = byId.get(c.id);
    return plan !== undefined && isChartPlan(plan) && renderBar(plan).ok;
  });
  const groups = new Map<string, MotionConceptSummary[]>();
  for (const c of offered) {
    const theme = themeOf(byId.get(c.id)!);
    groups.set(theme, [...(groups.get(theme) ?? []), c]);
  }
  const rounds = Math.max(0, ...[...groups.values()].map((g) => g.length));
  const ordered: MotionConceptSummary[] = [];
  for (let round = 0; round < rounds; round++) {
    for (const group of groups.values()) if (group[round]) ordered.push(group[round]!);
  }
  return ordered;
}

export async function runDailyChartCardRequests(deps: DailyChartCardDeps): Promise<string> {
  if (await deps.isPaused()) return "skipped -- the system is paused";
  const states = await deps.states();
  const concepts = offeredChartConcepts();
  const stateOf = (c: MotionConceptSummary) => states.get(manualMotionConceptTitle(c));
  const waiting = concepts.filter((c) => stateOf(c) === "waiting").length;
  const unused = concepts.filter((c) => stateOf(c) === undefined);

  if (unused.length === 0) return "no unused chart concepts left -- add more";
  const room = MAX_CHART_CARDS_WAITING - waiting;
  if (room <= 0) return `skipped -- ${waiting} chart cards already waiting (limit ${MAX_CHART_CARDS_WAITING})`;

  const requested: string[] = [];
  const failed: string[] = [];
  for (const concept of unused.slice(0, room)) {
    try {
      await deps.request(concept.id);
      requested.push(concept.id);
    } catch (err) {
      failed.push(`${concept.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (requested.length === 0 && failed.length > 0) throw new Error(`could not request any chart card -- ${failed.join("; ")}`);

  const left = unused.length - requested.length;
  const parts = [`requested ${requested.length} (${requested.join(", ")})`, `${waiting + requested.length} waiting`, `${left} unused left`];
  if (failed.length > 0) parts.push(`failed: ${failed.join("; ")}`);
  if (left < LOW_SUPPLY_AT) parts.push(`LOW SUPPLY: only ${left} unused chart concepts left -- add more`);
  return parts.join("; ");
}
