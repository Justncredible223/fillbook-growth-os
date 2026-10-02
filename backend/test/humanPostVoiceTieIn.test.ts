import { describe, it, expect } from "vitest";
import { HUMAN_POST_VOICE_RULES } from "../src/content/humanReplyVoice";

describe("HUMAN_POST_VOICE_RULES product tie-in", () => {
  // The growth_strategist review fails a post that is pure trader education or psychology with no product connection
  // (owner rule 2026-09-21). The writer must therefore be told to tie every post to Fillbook, not merely welcomed to.
  it("requires every post to tie back to a verified Fillbook capability, as a clause and not a pitch", () => {
    expect(HUMAN_POST_VOICE_RULES).toMatch(/Every post ties back to Fillbook/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/ONE short, plain clause/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/verified knowledge/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/no\s+feature list/);
    expect(HUMAN_POST_VOICE_RULES).not.toMatch(/welcome, tied to one concrete thing/);
  });

  it("keeps the honesty limits: nothing live or real-time, no promised outcome", () => {
    expect(HUMAN_POST_VOICE_RULES).toMatch(/never live or real-time monitoring/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/never a promise of any outcome/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/Never promise or imply profit/);
  });

  // The first version of the tie-in produced "computes the buffer from your synced trades so you know where you stand",
  // which the skeptic and fact_checker rejected as implying real-time knowledge (2026-10-02). The clause is limited to
  // what the screen shows, never when Fillbook knows it.
  it("limits the tie-in to what a screen shows and bans the timing phrases that failed review", () => {
    expect(HUMAN_POST_VOICE_RULES).toMatch(/WHAT the screen shows, never WHEN Fillbook knows it/);
    expect(HUMAN_POST_VOICE_RULES).toMatch(/imported or synced CLOSED trades/);
    for (const phrase of ["know where you stand", "as it happens", "while you trade", "mid-session", "before you breach", "in real time", "instantly", "alerts you before"]) {
      expect(HUMAN_POST_VOICE_RULES, phrase).toContain(`"${phrase}"`);
    }
  });
});
