import { findRepeatedHook } from "../content/videoHookVariety.js";
import { OriginalityEngine } from "../content/originalityEngine.js";
import type { ScenePlan } from "./types.js";

/**
 * Keeps near-copies out of what the owner is asked to choose from. A concept is a near-copy of another when what its
 * video says (the narration) overlaps by this much or more, or when it opens on the same hook. The 12 illustrative
 * "win rate isn't profit" cards measure 64-80% against each other: the same video with different numbers.
 */
export const MAX_CONCEPT_OVERLAP = 0.5;

const engine = new OriginalityEngine();
const spoken = (p: ScenePlan): string => p.scenes.map((s) => s.narration).join(" ");

/** True when two concepts would read to a viewer, or to the owner picking between them, as the same video. */
export function nearCopies(a: ScenePlan, b: ScenePlan): boolean {
  if (findRepeatedHook(a.hook, [b.hook]) !== null) return true;
  return (engine.compareAgainstRecent(spoken(a), [spoken(b)])[0]?.similarity ?? 0) >= MAX_CONCEPT_OVERLAP;
}

/**
 * `candidates` in their given order, minus any that is a near-copy of a concept already made or waiting (`usedIds`) or
 * of one kept earlier in the list. Nothing is deleted: a hidden concept stays in the catalog, so a script already drafted
 * or approved from it still renders. A candidate with no plan is kept (nothing to compare it on).
 */
export function distinctConcepts<T extends { id: string }>(candidates: readonly T[], usedIds: Iterable<string>, planOf: (id: string) => ScenePlan | undefined): T[] {
  const reference: ScenePlan[] = [];
  for (const id of usedIds) {
    const plan = planOf(id);
    if (plan) reference.push(plan);
  }
  const kept: T[] = [];
  for (const candidate of candidates) {
    const plan = planOf(candidate.id);
    if (plan && reference.some((r) => nearCopies(plan, r))) continue;
    kept.push(candidate);
    if (plan) reference.push(plan);
  }
  return kept;
}
