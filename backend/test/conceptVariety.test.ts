import { describe, it, expect } from "vitest";
import { MAX_CONCEPT_OVERLAP, distinctConcepts, nearCopies } from "../src/shortform/conceptVariety";
import { MOTION_SCENE_PLANS } from "../src/shortform/motionPlans";
import { offeredChartConcepts, runDailyChartCardRequests, type ConceptState } from "../src/video/dailyChartCardRequests";
import { manualMotionConceptTitle } from "../src/opportunities/manualMotionConcept";

const planOf = (id: string) => MOTION_SCENE_PLANS.find((p) => p.planId === id);
const offered = offeredChartConcepts();
const isOutcomes = (id: string) => id.startsWith("chart-o-");

describe("nearCopies", () => {
  it("treats the illustrative win-rate cards as copies of each other", () => {
    const outcomes = offered.filter((c) => isOutcomes(c.id)).map((c) => planOf(c.id)!);
    expect(outcomes).toHaveLength(12);
    for (let i = 0; i < outcomes.length; i++) for (let j = i + 1; j < outcomes.length; j++) expect(nearCopies(outcomes[i]!, outcomes[j]!), `${outcomes[i]!.planId} vs ${outcomes[j]!.planId}`).toBe(true);
  });

  it("treats the hand-made and bar-chart concepts as different videos", () => {
    const others = offered.filter((c) => !isOutcomes(c.id)).map((c) => planOf(c.id)!);
    expect(others).toHaveLength(12);
    for (let i = 0; i < others.length; i++) for (let j = i + 1; j < others.length; j++) expect(nearCopies(others[i]!, others[j]!), `${others[i]!.planId} vs ${others[j]!.planId}`).toBe(false);
    expect(MAX_CONCEPT_OVERLAP).toBeLessThanOrEqual(0.5);
  });
});

describe("distinctConcepts", () => {
  it("offers 12 different concepts plus one win-rate card, never a bunch of copies", () => {
    const kept = distinctConcepts(offered, [], planOf);
    expect(kept).toHaveLength(13);
    expect(kept.filter((c) => isOutcomes(c.id))).toHaveLength(1);
    expect(kept.map((c) => c.id)).toEqual(offered.filter((c) => kept.includes(c)).map((c) => c.id)); // order kept
    for (let i = 0; i < kept.length; i++) for (let j = i + 1; j < kept.length; j++) expect(nearCopies(planOf(kept[i]!.id)!, planOf(kept[j]!.id)!)).toBe(false);
  });

  it("hides every win-rate card once one has been made or is waiting", () => {
    const first = offered.find((c) => isOutcomes(c.id))!;
    const rest = offered.filter((c) => c !== first);
    expect(distinctConcepts(rest, [first.id], planOf).filter((c) => isOutcomes(c.id))).toEqual([]);
    expect(distinctConcepts(rest, [first.id], planOf).filter((c) => !isOutcomes(c.id))).toHaveLength(12);
  });

  it("does not hide a different concept because a made one is on another feature", () => {
    const kept = distinctConcepts(offered, ["chart-bars-day-of-week"], planOf);
    expect(kept.map((c) => c.id)).toContain("chart-bars-time-of-day");
  });

  it("keeps a candidate it has no plan for, and leaves the input alone", () => {
    const input = [{ id: "unknown-concept" }];
    expect(distinctConcepts(input, [], planOf)).toEqual(input);
    expect(offeredChartConcepts()).toHaveLength(24);
  });
});

describe("the daily refill never queues two near-copies", () => {
  it("over a whole run of the supply, requests only mutually different concepts and then reports none left", async () => {
    const states = new Map<string, ConceptState>();
    const requested: string[] = [];
    const deps = {
      isPaused: async () => false,
      states: async () => states,
      request: async (id: string) => {
        requested.push(id);
        const c = offered.find((x) => x.id === id)!;
        states.set(manualMotionConceptTitle(c), "made");
        return { campaignRunRequestId: `run-${id}`, opportunityId: `opp-${id}` };
      },
    };
    let report = "";
    for (let day = 0; day < 20 && !report.startsWith("no unused"); day++) report = await runDailyChartCardRequests(deps);
    expect(requested).toHaveLength(13);
    expect(new Set(requested).size).toBe(13);
    expect(requested.filter(isOutcomes)).toHaveLength(1);
    for (let i = 0; i < requested.length; i++) for (let j = i + 1; j < requested.length; j++) expect(nearCopies(planOf(requested[i]!)!, planOf(requested[j]!)!)).toBe(false);
    expect(report).toMatch(/no unused chart concepts left/);
  });
});
