import { describe, it, expect } from "vitest";
import { isValidTransition, isTerminalStage, canMarkContacted } from "../src/partnerships/stageTransitions";
import type { PartnershipStage } from "../src/partnerships/types";

const ALL_STAGES: PartnershipStage[] = [
  "prospect", "qualified", "draft_ready", "contacted", "replied", "pilot", "active_partner", "closed", "archived", "do_not_contact",
];

describe("isValidTransition -- the allowed stage graph", () => {
  it("allows the normal forward path prospect -> qualified -> draft_ready -> contacted -> replied -> pilot -> active_partner -> closed", () => {
    const path: PartnershipStage[] = ["prospect", "qualified", "draft_ready", "contacted", "replied", "pilot", "active_partner", "closed"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("also allows replied -> closed directly (skip pilot for a partner that declines a pilot but still resolves positively is out of scope -- but replied -> closed itself is a legitimate 'they said no' outcome)", () => {
    expect(isValidTransition("replied", "closed")).toBe(true);
  });

  it("never allows a forward skip (e.g. prospect straight to draft_ready, or straight to contacted)", () => {
    expect(isValidTransition("prospect", "draft_ready")).toBe(false);
    expect(isValidTransition("prospect", "contacted")).toBe(false);
    expect(isValidTransition("qualified", "contacted")).toBe(false);
  });

  it("archived and do_not_contact are reachable from every non-terminal stage -- an owner can bail at any point", () => {
    const nonTerminal: PartnershipStage[] = ["prospect", "qualified", "draft_ready", "contacted", "replied", "pilot", "active_partner"];
    for (const stage of nonTerminal) {
      expect(isValidTransition(stage, "archived")).toBe(true);
      expect(isValidTransition(stage, "do_not_contact")).toBe(true);
    }
  });

  it("terminal stages (closed, archived, do_not_contact) never transition anywhere, including to each other", () => {
    const terminal: PartnershipStage[] = ["closed", "archived", "do_not_contact"];
    for (const from of terminal) {
      for (const to of ALL_STAGES) {
        expect(isValidTransition(from, to)).toBe(false);
      }
    }
  });

  it("a stage never transitions to itself", () => {
    for (const stage of ALL_STAGES) {
      expect(isValidTransition(stage, stage)).toBe(false);
    }
  });
});

describe("isTerminalStage", () => {
  it("closed/archived/do_not_contact are terminal; everything else is not", () => {
    expect(isTerminalStage("closed")).toBe(true);
    expect(isTerminalStage("archived")).toBe(true);
    expect(isTerminalStage("do_not_contact")).toBe(true);
    expect(isTerminalStage("prospect")).toBe(false);
    expect(isTerminalStage("pilot")).toBe(false);
  });
});

describe("canMarkContacted -- approval vs. actual contact guarantee", () => {
  it("requires BOTH stage=draft_ready AND a real approved draft -- neither alone is sufficient", () => {
    expect(canMarkContacted("draft_ready", "asset-1")).toBe(true);
    expect(canMarkContacted("draft_ready", null)).toBe(false);
    expect(canMarkContacted("prospect", "asset-1")).toBe(false);
    expect(canMarkContacted("qualified", "asset-1")).toBe(false);
  });
});
