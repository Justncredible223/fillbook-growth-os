import { describe, it, expect } from "vitest";
import { findRepeatedHook, formatRecentVideos } from "../src/content/videoHookVariety";

const recent = [
  "You already know which trade you're about to repeat. You just haven't written it down yet.",
  "Your brain forgets the bad trade in 24 hours.",
  "Copy-trading five funded accounts means one mistake gets made five times.",
];

describe("findRepeatedHook", () => {
  it("flags the same opening even when the rest differs", () => {
    expect(findRepeatedHook("You already know which trade you're about to blow up. Here is why.", recent)).toBe(recent[0]);
  });

  it("flags a near-copy that reorders a few words", () => {
    expect(findRepeatedHook("Copy-trading five funded accounts means one mistake gets made five times over.", recent)).toBe(recent[2]);
  });

  it("ignores case and punctuation", () => {
    expect(findRepeatedHook("YOUR BRAIN FORGETS the bad trade in 24 hours!!", recent)).toBe(recent[1]);
  });

  it("passes a genuinely different hook", () => {
    expect(findRepeatedHook("Your loss limit doesn't care that the trade was a good one.", recent)).toBeNull();
  });

  it("does not flag a hook that only shares a couple of common words", () => {
    expect(findRepeatedHook("You can pass the eval and still lose the account on payout day.", recent)).toBeNull();
  });

  it("is fine with no history, and with an empty hook", () => {
    expect(findRepeatedHook("Anything at all here.", [])).toBeNull();
    expect(findRepeatedHook("", recent)).toBeNull();
  });
});

describe("formatRecentVideos", () => {
  it("is empty when there is no history", () => {
    expect(formatRecentVideos([])).toBe("");
  });

  it("lists each recent hook and title under an instruction not to echo them", () => {
    const text = formatRecentVideos([{ hook: "Hook A", title: "Title A" }, { hook: "Hook B", title: "" }]);
    expect(text).toContain("do not reuse or closely echo");
    expect(text).toContain("- Hook: Hook A | Title: Title A");
    expect(text).toContain("- Hook: Hook B");
    expect(text).not.toContain("Hook B |");
  });
});
