import { describe, it, expect } from "vitest";
import { InMemoryAutoDraftRunRepository } from "../src/opportunities/autoDraftRunRepository";

describe("InMemoryAutoDraftRunRepository (idempotency contract)", () => {
  it("claiming the same run_date twice only succeeds once -- this IS the idempotency mechanism", async () => {
    const repo = new InMemoryAutoDraftRunRepository();

    const first = await repo.claimRun("2026-09-08");
    const second = await repo.claimRun("2026-09-08");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("a different run_date can be claimed independently", async () => {
    const repo = new InMemoryAutoDraftRunRepository();

    const day1 = await repo.claimRun("2026-09-08");
    const day2 = await repo.claimRun("2026-09-09");

    expect(day1).not.toBeNull();
    expect(day2).not.toBeNull();
    expect(day1).not.toBe(day2);
  });

  it("getMonthSpendUsd only sums 'drafted' runs within the given month", async () => {
    const repo = new InMemoryAutoDraftRunRepository();
    const id1 = await repo.claimRun("2026-09-01");
    await repo.completeRun(id1!, {
      status: "drafted",
      opportunitiesConsidered: 1,
      opportunitiesEligible: 1,
      aiCalls: 10,
      costUsd: 0.09,
      durationMs: 1000,
    });
    const id2 = await repo.claimRun("2026-09-02");
    await repo.completeRun(id2!, {
      status: "skipped",
      skipReason: "no_qualifying_opportunity",
      opportunitiesConsidered: 5,
      opportunitiesEligible: 0,
      aiCalls: 0,
      costUsd: 0,
      durationMs: 50,
    });
    const id3 = await repo.claimRun("2026-08-15");
    await repo.completeRun(id3!, {
      status: "drafted",
      opportunitiesConsidered: 1,
      opportunitiesEligible: 1,
      aiCalls: 10,
      costUsd: 100, // different month -- must not count
      durationMs: 1000,
    });

    expect(await repo.getMonthSpendUsd("2026-09")).toBeCloseTo(0.09, 6);
  });
});
