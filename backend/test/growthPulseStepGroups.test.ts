import { describe, it, expect } from "vitest";
import { resolveStepGroups } from "../api/growth-pulse";

describe("resolveStepGroups", () => {
  it("runs every group when no flags are present at all (manual run-now)", () => {
    expect(resolveStepGroups({})).toEqual({ x: true, redditInbound: true, redditProspecting: true });
  });

  it("the 08:00/13:00/18:00 Phoenix slots: X + Reddit inbound, not Reddit prospecting", () => {
    expect(resolveStepGroups({ x: "true", redditInbound: "true", redditProspecting: "false" })).toEqual({
      x: true,
      redditInbound: true,
      redditProspecting: false,
    });
  });

  it("the 09:00 Phoenix slot: Reddit prospecting only, never also X -- X must never exceed 3 windows/day", () => {
    expect(resolveStepGroups({ x: "false", redditInbound: "false", redditProspecting: "true" })).toEqual({
      x: false,
      redditInbound: false,
      redditProspecting: true,
    });
  });

  it("accepts '1' as well as 'true'", () => {
    expect(resolveStepGroups({ x: "1", redditInbound: "0", redditProspecting: "0" })).toEqual({
      x: true,
      redditInbound: false,
      redditProspecting: false,
    });
  });

  it("an unrecognized flag value is treated as false, not silently true", () => {
    expect(resolveStepGroups({ x: "yes please" })).toEqual({ x: false, redditInbound: false, redditProspecting: false });
  });
});
