import { describe, it, expect } from "vitest";
import { isPlausiblyTradingRelated } from "../src/prospecting/prospectingRelevance";

/**
 * Regression coverage for a real, confirmed bug: Prospecting surfaced
 * posts with zero connection to futures/prop-firm trading -- a sci-fi
 * story teaser scored 51 and got queued under the "Hesitation" topic
 * purely from generic engagement/length heuristics that never checked
 * the post text itself. This predicate is the $0 pre-filter that closes
 * that gap, run before any LLM call is made.
 */
describe("isPlausiblyTradingRelated", () => {
  it("rejects the exact sci-fi post that exposed this bug live", () => {
    const postText =
      'What if trust begins where certainty ends?\nIn #2084, a civilization built on prediction discovers the one thing an algorithm cannot give you: a reason...';
    expect(isPlausiblyTradingRelated(postText)).toBe(false);
  });

  it("rejects a generic non-trading post using only bare generic words like 'entry' or 'performance'", () => {
    expect(isPlausiblyTradingRelated("Every entry into the competition counts toward your final performance score.")).toBe(false);
    expect(isPlausiblyTradingRelated("The event's performance metrics were announced at the entry gate.")).toBe(false);
  });

  it("accepts a genuine futures post", () => {
    expect(isPlausiblyTradingRelated("Been trading MNQ futures for two years and still get nervous before the open.")).toBe(true);
  });

  it("accepts a genuine prop-firm/drawdown post with no mention of 'futures' at all", () => {
    expect(isPlausiblyTradingRelated("Failed my prop firm evaluation because of a trailing drawdown rule I didn't fully understand.")).toBe(true);
    expect(isPlausiblyTradingRelated("My funded account got pulled today. Consistency rule got me again.")).toBe(true);
  });

  it("does not require the literal word 'futures' when strong trading context is present", () => {
    expect(isPlausiblyTradingRelated("Overtrading after a losing streak is how most funded accounts actually blow up.")).toBe(true);
  });

  it("catches other real trading-discipline vocabulary with no 'futures' or 'trading' word present", () => {
    expect(isPlausiblyTradingRelated("Hit my daily loss limit again. Same mistake, third time this month.")).toBe(true);
    expect(isPlausiblyTradingRelated("Position sizing is the one thing nobody teaches new traders properly.")).toBe(true);
  });

  it("rejects ordinary text that happens to contain short substrings without real trading meaning", () => {
    expect(isPlausiblyTradingRelated("The market for artisanal bread has never been better in this neighborhood.")).toBe(false);
    expect(isPlausiblyTradingRelated("She wrote in her journal about the discipline it takes to finish a marathon.")).toBe(false);
  });
});
