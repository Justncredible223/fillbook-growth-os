import { describe, it, expect } from "vitest";
import { resolveStepGroups } from "../api/growth-pulse";

describe("resolveStepGroups", () => {
  it("runs every group when no flags are present at all (manual run-now)", () => {
    expect(resolveStepGroups({})).toEqual({ x: true, partnerships: true, videoReconciliation: true });
  });

  it("the 08:00/13:00/18:00 Phoenix slots: X + partnerships + video reconciliation", () => {
    expect(resolveStepGroups({ x: "true", partnerships: "true", videoReconciliation: "true" })).toEqual({
      x: true,
      partnerships: true,
      videoReconciliation: true,
    });
  });

  it("accepts '1' as well as 'true'", () => {
    expect(resolveStepGroups({ x: "1", partnerships: "0", videoReconciliation: "1" })).toEqual({
      x: true,
      partnerships: false,
      videoReconciliation: true,
    });
  });

  it("an unrecognized flag value is treated as false, not silently true", () => {
    expect(resolveStepGroups({ x: "yes please" })).toEqual({ x: false, partnerships: false, videoReconciliation: false });
  });

  it("partnerships flag alone still counts as a flag present, so unlisted groups default to false rather than running everything", () => {
    expect(resolveStepGroups({ partnerships: "true" })).toEqual({ x: false, partnerships: true, videoReconciliation: false });
  });
});
