import { describe, it, expect } from "vitest";
import { decideNotifications } from "../src/notifications/notificationEngine";

function baseInput() {
  return {
    failedSteps: [],
    newHighScoreOpportunities: [],
    freshStrategyVersion: null,
    newSignificantExperiments: [],
  };
}

describe("decideNotifications", () => {
  it("produces nothing for a quiet, uneventful run", () => {
    expect(decideNotifications(baseInput())).toEqual([]);
  });

  it("notifies on a failed pipeline step", () => {
    const result = decideNotifications({ ...baseInput(), failedSteps: [{ step: "youtube", detail: "token expired" }] });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("platform_failure");
    expect(result[0]!.severity).toBe("warning");
  });

  it("notifies on a high-score opportunity but not a mediocre one", () => {
    const result = decideNotifications({
      ...baseInput(),
      newHighScoreOpportunities: [
        { id: "o1", title: "Great topic", score: 80 },
        { id: "o2", title: "Meh topic", score: 40 },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.relatedId).toBe("o1");
  });

  it("notifies on a fresh strategy version only when it has actionable items", () => {
    const withActionable = decideNotifications({
      ...baseInput(),
      freshStrategyVersion: { version: 3, actionableCount: 2 },
    });
    expect(withActionable).toHaveLength(1);
    expect(withActionable[0]!.type).toBe("strategy_updated");

    const withoutActionable = decideNotifications({
      ...baseInput(),
      freshStrategyVersion: { version: 3, actionableCount: 0 },
    });
    expect(withoutActionable).toHaveLength(0);
  });

  it("notifies on a newly significant experiment", () => {
    const result = decideNotifications({
      ...baseInput(),
      newSignificantExperiments: [{ id: "e1", hypothesis: "more video helps", interpretation: "pass rate improved" }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("experiment_significant");
  });

  it("combines multiple simultaneous events without dropping any", () => {
    const result = decideNotifications({
      failedSteps: [{ step: "tiktok", detail: "rate limited" }],
      newHighScoreOpportunities: [{ id: "o1", title: "x", score: 90 }],
      freshStrategyVersion: { version: 1, actionableCount: 1 },
      newSignificantExperiments: [{ id: "e1", hypothesis: "h", interpretation: "i" }],
    });
    expect(result).toHaveLength(4);
  });
});
