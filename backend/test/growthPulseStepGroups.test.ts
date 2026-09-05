import { describe, it, expect } from "vitest";
import { resolveStepGroups } from "../api/growth-pulse";

describe("resolveStepGroups", () => {
  it("runs every group when no flags are present at all (manual run-now)", () => {
    expect(resolveStepGroups({})).toEqual({ x: true, redditInbound: true, redditProspecting: true, partnerships: true });
  });

  it("the 08:00/13:00/18:00 Phoenix slots: X + Reddit inbound, not Reddit prospecting or partnerships", () => {
    expect(resolveStepGroups({ x: "true", redditInbound: "true", redditProspecting: "false", partnerships: "false" })).toEqual({
      x: true,
      redditInbound: true,
      redditProspecting: false,
      partnerships: false,
    });
  });

  it("the 09:00 Phoenix slot: Reddit prospecting + partnerships discovery, never also X -- X must never exceed 3 windows/day", () => {
    expect(resolveStepGroups({ x: "false", redditInbound: "false", redditProspecting: "true", partnerships: "true" })).toEqual({
      x: false,
      redditInbound: false,
      redditProspecting: true,
      partnerships: true,
    });
  });

  it("accepts '1' as well as 'true'", () => {
    expect(resolveStepGroups({ x: "1", redditInbound: "0", redditProspecting: "0", partnerships: "0" })).toEqual({
      x: true,
      redditInbound: false,
      redditProspecting: false,
      partnerships: false,
    });
  });

  it("an unrecognized flag value is treated as false, not silently true", () => {
    expect(resolveStepGroups({ x: "yes please" })).toEqual({ x: false, redditInbound: false, redditProspecting: false, partnerships: false });
  });

  it("partnerships flag alone still counts as a flag present, so unlisted groups default to false rather than running everything", () => {
    expect(resolveStepGroups({ partnerships: "true" })).toEqual({ x: false, redditInbound: false, redditProspecting: false, partnerships: true });
  });
});
