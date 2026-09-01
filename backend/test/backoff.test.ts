import { describe, it, expect } from "vitest";
import { decideRetry } from "../src/jobs/backoff";

describe("decideRetry", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("schedules a retry with exponential backoff below max_attempts", () => {
    const d1 = decideRetry(1, 5, now);
    expect(d1.deadLetter).toBe(false);
    expect(d1.runAfter.getTime() - now.getTime()).toBe(30_000);

    const d2 = decideRetry(2, 5, now);
    expect(d2.runAfter.getTime() - now.getTime()).toBe(60_000);

    const d3 = decideRetry(3, 5, now);
    expect(d3.runAfter.getTime() - now.getTime()).toBe(120_000);
  });

  it("caps backoff at 30 minutes", () => {
    const d = decideRetry(20, 25, now);
    expect(d.deadLetter).toBe(false);
    expect(d.runAfter.getTime() - now.getTime()).toBe(30 * 60_000);
  });

  it("dead-letters once attempts reach max_attempts", () => {
    const d = decideRetry(5, 5, now);
    expect(d.deadLetter).toBe(true);
  });

  it("dead-letters if attempts somehow exceed max_attempts", () => {
    const d = decideRetry(6, 5, now);
    expect(d.deadLetter).toBe(true);
  });
});
