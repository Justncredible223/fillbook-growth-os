import { describe, it, expect } from "vitest";
import { OriginalityEngine } from "../src/content/originalityEngine";

describe("OriginalityEngine", () => {
  const engine = new OriginalityEngine();

  it("flags near-duplicate content as too similar", () => {
    const original = "A profitable day can still contain objectively bad trading behavior.";
    const nearDuplicate = "A profitable day can still contain objectively bad trading habits.";
    expect(engine.isTooSimilar(nearDuplicate, [original])).toBe(true);
  });

  it("does not flag genuinely different content", () => {
    const original = "A profitable day can still contain objectively bad trading behavior.";
    const different = "Most funded accounts get pulled for violating a rule nobody reads twice.";
    expect(engine.isTooSimilar(different, [original])).toBe(false);
  });

  it("ranks recent texts by similarity, most similar first", () => {
    const candidate = "Trailing drawdown rules confuse more traders than max drawdown does.";
    const results = engine.compareAgainstRecent(candidate, [
      "The weather today has nothing to do with trading at all.",
      "Trailing drawdown confuses traders more than static max drawdown.",
    ]);
    expect(results[0]!.againstIndex).toBe(1);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
  });

  it("treats empty comparison text as zero similarity, not a crash", () => {
    expect(engine.isTooSimilar("some real content here", [""])).toBe(false);
  });
});
