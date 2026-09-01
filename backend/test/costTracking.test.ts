import { describe, it, expect } from "vitest";
import { estimateCostUsd } from "../src/cost/costTracking";

describe("estimateCostUsd", () => {
  it("computes cost from real per-million-token pricing", () => {
    const cost = estimateCostUsd({ model: "claude-sonnet-4-5-20250929", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it("scales linearly with token count", () => {
    const cost = estimateCostUsd({ model: "claude-sonnet-4-5-20250929", inputTokens: 100, outputTokens: 50 });
    expect(cost).toBeCloseTo((100 / 1_000_000) * 3 + (50 / 1_000_000) * 15, 9);
  });

  it("falls back to default pricing for an unrecognized model rather than throwing", () => {
    expect(() => estimateCostUsd({ model: "some-future-model", inputTokens: 10, outputTokens: 10 })).not.toThrow();
  });
});
