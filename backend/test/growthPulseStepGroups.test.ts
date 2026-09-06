import { describe, it, expect } from "vitest";
import { resolveStepGroups } from "../api/growth-pulse";

describe("resolveStepGroups", () => {
  it("runs every group when no flags are present at all (manual run-now)", () => {
    expect(resolveStepGroups({})).toEqual({ x: true, partnerships: true });
  });

  it("the 08:00/13:00/18:00 Phoenix slots: X + partnerships", () => {
    expect(resolveStepGroups({ x: "true", partnerships: "true" })).toEqual({
      x: true,
      partnerships: true,
    });
  });

  it("accepts '1' as well as 'true'", () => {
    expect(resolveStepGroups({ x: "1", partnerships: "0" })).toEqual({
      x: true,
      partnerships: false,
    });
  });

  it("an unrecognized flag value is treated as false, not silently true", () => {
    expect(resolveStepGroups({ x: "yes please" })).toEqual({ x: false, partnerships: false });
  });

  it("partnerships flag alone still counts as a flag present, so unlisted groups default to false rather than running everything", () => {
    expect(resolveStepGroups({ partnerships: "true" })).toEqual({ x: false, partnerships: true });
  });
});
