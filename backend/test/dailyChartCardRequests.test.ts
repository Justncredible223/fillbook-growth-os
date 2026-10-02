import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { distinctConcepts } from "../src/shortform/conceptVariety";
import { MOTION_SCENE_PLANS } from "../src/shortform/motionPlans";
import { LOW_SUPPLY_AT, MAX_CHART_CARDS_WAITING, offeredChartConcepts, runDailyChartCardRequests, type ConceptState, type DailyChartCardDeps } from "../src/video/dailyChartCardRequests";
import { manualMotionConceptTitle } from "../src/opportunities/manualMotionConcept";

const concepts = offeredChartConcepts();
const titleOf = (i: number) => manualMotionConceptTitle(concepts[i]!);

function deps(opts: { paused?: boolean; states?: Array<[number, ConceptState]>; fail?: (id: string) => boolean } = {}) {
  const requested: string[] = [];
  const d: DailyChartCardDeps = {
    isPaused: async () => opts.paused ?? false,
    states: async () => new Map((opts.states ?? []).map(([i, s]) => [titleOf(i), s] as const)),
    request: vi.fn(async (id: string) => {
      if (opts.fail?.(id)) throw new Error(`boom ${id}`);
      requested.push(id);
      return { campaignRunRequestId: `run-${id}`, opportunityId: `opp-${id}` };
    }),
  };
  return { d, requested };
}

describe("the chart concepts the daily refill draws from", () => {
  it("are only chart cards that clear the bar: 3 hand-made, 9 bar charts and the illustrative ones", () => {
    expect(concepts).toHaveLength(24);
    expect(concepts.every((c) => c.id.startsWith("chart-"))).toBe(true);
    expect(concepts.filter((c) => c.id.startsWith("chart-bars-"))).toHaveLength(9);
    expect(concepts.filter((c) => c.id.startsWith("chart-o-"))).toHaveLength(12);
    expect(concepts.map((c) => c.id)).toEqual(expect.arrayContaining(["chart-a-17-green-days", "chart-b-10-green-days", "chart-c-one-signal-two-accounts"]));
  });

  it("are served in a fixed order that rotates through themes, so the same template never runs back to back", () => {
    expect(concepts.map((c) => c.id)).toEqual(offeredChartConcepts().map((c) => c.id));
    // The first requests, one per theme: a payout card, the two-accounts card, then each bar chart, then one illustrative card.
    expect(concepts.slice(0, 3).map((c) => c.id)).toEqual(["chart-a-17-green-days", "chart-c-one-signal-two-accounts", "chart-bars-day-of-week"]);
    expect(concepts.slice(0, 11).filter((c) => c.id.startsWith("chart-o-"))).toHaveLength(0);
    expect(concepts.slice(0, 12).filter((c) => c.id.startsWith("chart-o-"))).toHaveLength(1);
  });
});

describe("runDailyChartCardRequests", () => {
  it("requests nothing while the system is paused", async () => {
    const { d, requested } = deps({ paused: true });
    expect(await runDailyChartCardRequests(d)).toMatch(/paused/);
    expect(requested).toEqual([]);
  });

  it("with nothing waiting, requests up to the waiting limit, in catalog order", async () => {
    const { d, requested } = deps();
    const report = await runDailyChartCardRequests(d);
    expect(requested).toEqual(concepts.slice(0, MAX_CHART_CARDS_WAITING).map((c) => c.id));
    expect(report).toContain(`requested ${MAX_CHART_CARDS_WAITING}`);
  });

  it("tops up to the limit when some are already waiting, and does nothing at the limit", async () => {
    const two = deps({ states: [[0, "waiting"], [1, "waiting"]] });
    await runDailyChartCardRequests(two.d);
    expect(two.requested).toEqual([concepts[2]!.id]);

    const full = deps({ states: [[0, "waiting"], [1, "waiting"], [2, "waiting"]] });
    expect(await runDailyChartCardRequests(full.d)).toMatch(/already waiting/);
    expect(full.requested).toEqual([]);
  });

  it("never requests a concept that is made, rejected or waiting, so each is used exactly once", async () => {
    const { d, requested } = deps({ states: [[0, "made"], [1, "rejected"], [2, "waiting"]] });
    await runDailyChartCardRequests(d);
    expect(requested).toEqual([concepts[3]!.id, concepts[4]!.id]);
  });

  it("says so when every chart concept is used up", async () => {
    const { d, requested } = deps({ states: concepts.map((_, i) => [i, "made"] as [number, ConceptState]) });
    expect(await runDailyChartCardRequests(d)).toMatch(/no unused chart concepts left/);
    expect(requested).toEqual([]);
  });

  it("warns when the unused supply runs low", async () => {
    // Supply is counted in DIFFERENT concepts: the near-copies of a made one are hidden, so they are not supply.
    const distinct = distinctConcepts(concepts, [], (id) => MOTION_SCENE_PLANS.find((p) => p.planId === id));
    const used = distinct.slice(0, distinct.length - (LOW_SUPPLY_AT + 1)).map((c) => [concepts.indexOf(c), "made"] as [number, ConceptState]);
    const { d } = deps({ states: used });
    expect(await runDailyChartCardRequests(d)).toMatch(/LOW SUPPLY/);
  });

  it("keeps going when one request fails, and reports it; it fails loudly only if none could be requested", async () => {
    const some = deps({ fail: (id) => id === concepts[1]!.id });
    const report = await runDailyChartCardRequests(some.d);
    expect(some.requested).toEqual([concepts[0]!.id, concepts[2]!.id]);
    expect(report).toContain("failed:");

    const none = deps({ fail: () => true });
    await expect(runDailyChartCardRequests(none.d)).rejects.toThrow(/could not request any chart card/);
  });
});

describe("the daily refill stays wired in and stays inside its limits", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf-8");

  it("runs as its own isolated step of the growth pulse's video group", () => {
    const src = read("api/growth-pulse.ts");
    expect(src).toContain('runStep("chart_card_requests"');
    expect(src.indexOf("if (runVideoReconciliation)")).toBeLessThan(src.indexOf('runStep("chart_card_requests"'));
  });

  it("only ever queues a request: nothing in the refill approves, renders or publishes", () => {
    // Comments explain what the refill does NOT do, so they are stripped before looking for anything that does it.
    const code = (read("src/video/dailyChartCardRequests.ts") + read("src/opportunities/requestMotionConcept.ts")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/approve|enqueue_video_render|publish|youtube|tiktok/i);
  });
});
