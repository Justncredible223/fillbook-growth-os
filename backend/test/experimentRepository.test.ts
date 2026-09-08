import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { SupabaseExperimentRepository, experimentWindows, measureExperiment } from "../src/experiments/supabaseExperimentRepository";
import type { Experiment, ExperimentResult } from "../src/experiments/types";

const now = new Date("2026-09-04T15:30:00.000Z");

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "exp-1",
    hypothesis: "Shorter hooks pass review more often",
    scope: {},
    guardrailNote: null,
    status: "running",
    startDate: "2026-09-04", // started TODAY
    endDate: null,
    controlWindowStart: "2026-08-21",
    createdAt: "2026-09-04T08:00:00.000Z",
    result: null,
    ...overrides,
  };
}

function asset(id: string, createdAt: string, verdicts: string[], platform = "x") {
  return {
    id,
    platform,
    asset_type: "post",
    created_at: createdAt,
    content_versions: [
      { id: `${id}-v1`, version: 1, content_scores: [{ verdict: "fail" }] }, // superseded -- must never count
      { id: `${id}-v2`, version: 2, content_scores: verdicts.map((verdict) => ({ verdict })) },
    ],
  };
}

describe("experimentWindows -- explicit, half-open UTC bounds", () => {
  it("a running experiment's treatment window ends at the current instant, so assets created earlier today are included", () => {
    const windows = experimentWindows(experiment(), now);

    expect(windows).toEqual({
      controlStart: "2026-08-21T00:00:00.000Z",
      controlEndExclusive: "2026-09-04T00:00:00.000Z",
      treatmentStart: "2026-09-04T00:00:00.000Z",
      treatmentEndExclusive: now.toISOString(),
    });
    // The old bound: today's DATE string, which `.lt()` reads as 00:00Z today -> excluded the whole day.
    expect(windows.treatmentEndExclusive > "2026-09-04").toBe(true);
  });

  it("a completed experiment includes its end date in full (exclusive bound is the following midnight UTC)", () => {
    const windows = experimentWindows(experiment({ endDate: "2026-09-10" }), now);

    expect(windows.treatmentEndExclusive).toBe("2026-09-11T00:00:00.000Z");
  });

  it("date-only start boundaries stay intentional: the control window is [controlWindowStart 00:00Z, startDate 00:00Z)", () => {
    const windows = experimentWindows(experiment({ startDate: "2026-09-01", controlWindowStart: "2026-08-18" }), now);

    expect(windows.controlStart).toBe("2026-08-18T00:00:00.000Z");
    expect(windows.controlEndExclusive).toBe("2026-09-01T00:00:00.000Z");
    expect(windows.treatmentStart).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("measureExperiment", () => {
  it("counts an asset created earlier TODAY toward a same-day experiment's treatment (regression: current day was excluded)", async () => {
    const client = new FakeSupabaseClient({
      campaign_assets: [
        asset("today", "2026-09-04T09:00:00.000Z", ["pass", "pass"]),
        asset("yesterday", "2026-09-03T12:00:00.000Z", ["pass", "fail"]),
        asset("ancient", "2026-08-01T12:00:00.000Z", ["pass"]), // before the control window
      ],
    });

    const { control, treatment } = await measureExperiment(asSupabase(client), experiment(), now);

    expect(treatment).toEqual({ successes: 1, total: 1 });
    expect(control).toEqual({ successes: 0, total: 1 });

    const [controlQuery, treatmentQuery] = client.queriesFor("campaign_assets");
    expect(controlQuery!.filters).toEqual([
      { kind: "gte", column: "created_at", value: "2026-08-21T00:00:00.000Z" },
      { kind: "lt", column: "created_at", value: "2026-09-04T00:00:00.000Z" },
    ]);
    expect(treatmentQuery!.filters).toEqual([
      { kind: "gte", column: "created_at", value: "2026-09-04T00:00:00.000Z" },
      { kind: "lt", column: "created_at", value: now.toISOString() },
    ]);
  });

  it("only the highest-numbered content version's scores count, and an asset without scores is excluded from the sample", async () => {
    const unscored = { id: "unscored", platform: "x", asset_type: "post", created_at: "2026-09-04T10:00:00.000Z", content_versions: [{ id: "u-v1", version: 1, content_scores: [] }] };
    const client = new FakeSupabaseClient({ campaign_assets: [asset("a", "2026-09-04T10:00:00.000Z", ["pass"]), unscored] });

    const { treatment } = await measureExperiment(asSupabase(client), experiment(), now);

    expect(treatment).toEqual({ successes: 1, total: 1 });
  });

  it("applies the experiment's platform/assetType scope as query filters", async () => {
    const client = new FakeSupabaseClient({
      campaign_assets: [asset("x-asset", "2026-09-04T10:00:00.000Z", ["pass"], "x"), asset("tiktok-asset", "2026-09-04T10:00:00.000Z", ["pass"], "tiktok")],
    });

    const { treatment } = await measureExperiment(asSupabase(client), experiment({ scope: { platform: "tiktok", assetType: "post" } }), now);

    expect(treatment).toEqual({ successes: 1, total: 1 });
    expect(client.queriesFor("campaign_assets")[1]!.filters).toContainEqual({ kind: "eq", column: "platform", value: "tiktok" });
    expect(client.queriesFor("campaign_assets")[1]!.filters).toContainEqual({ kind: "eq", column: "asset_type", value: "post" });
  });

  it("propagates a query error instead of reporting an empty window", async () => {
    const client = new FakeSupabaseClient({ campaign_assets: [] });
    client.failTable("campaign_assets", { message: "connection reset" });

    await expect(measureExperiment(asSupabase(client), experiment(), now)).rejects.toMatchObject({ message: "connection reset" });
  });
});

describe("SupabaseExperimentRepository.recordProvisionalResult -- 'Check now' persists without completing", () => {
  const result: ExperimentResult = {
    controlRate: 0.5,
    treatmentRate: 0.9,
    absoluteDifference: 0.4,
    pValue: 0.01,
    isSignificant: true,
    insufficientSample: false,
    controlSampleSize: 20,
    treatmentSampleSize: 20,
    interpretation: "Review pass rate improved.",
    computedAt: now.toISOString(),
  };

  it("writes ONLY the result column, leaves status running and end_date null, and returns the persisted row", async () => {
    const client = new FakeSupabaseClient({
      experiments: [{ id: "exp-1", hypothesis: "h", scope: {}, guardrail_note: null, status: "running", start_date: "2026-09-04", end_date: null, control_window_start: "2026-08-21", created_at: "2026-09-04T08:00:00.000Z", result: null }],
    });
    const repo = new SupabaseExperimentRepository(asSupabase(client));

    const measured = await repo.recordProvisionalResult("exp-1", result);

    expect(measured.status).toBe("running");
    expect(measured.endDate).toBeNull();
    expect(measured.result).toEqual(result);
    const update = client.queriesFor("experiments").find((q) => q.op === "update")!;
    expect(update.payload).toEqual({ result });
    expect(update.filters).toEqual([{ kind: "eq", column: "id", value: "exp-1" }]);

    // The persisted result is what a subsequent list() -- i.e. the app's next refresh -- returns.
    const listed = await repo.list();
    expect(listed[0]!.result).toEqual(result);
    expect(listed[0]!.status).toBe("running");
  });

  it("complete() is unchanged: it is the only path that sets status=completed and end_date", async () => {
    const client = new FakeSupabaseClient({
      experiments: [{ id: "exp-1", hypothesis: "h", scope: {}, guardrail_note: null, status: "running", start_date: "2026-09-04", end_date: null, control_window_start: "2026-08-21", created_at: "2026-09-04T08:00:00.000Z", result: null }],
    });
    const repo = new SupabaseExperimentRepository(asSupabase(client));

    const completed = await repo.complete("exp-1", result, "2026-09-10");

    expect(completed.status).toBe("completed");
    expect(completed.endDate).toBe("2026-09-10");
  });

  it("propagates a failed update", async () => {
    const client = new FakeSupabaseClient({ experiments: [] });
    client.failTable("experiments", { message: "permission denied" }, "update");
    const repo = new SupabaseExperimentRepository(asSupabase(client));

    await expect(repo.recordProvisionalResult("exp-1", result)).rejects.toMatchObject({ message: "permission denied" });
  });
});
