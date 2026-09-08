import { describe, it, expect } from "vitest";
import { chunk, mapWithConcurrency } from "../src/lib/concurrency";

describe("mapWithConcurrency", () => {
  it("preserves input order in the result regardless of completion order", async () => {
    const delays = [30, 5, 20, 1];
    const result = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(result).toEqual(["0:30", "1:5", "2:20", "3:1"]);
  });

  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it("rejects with the first failure", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("two failed");
        return n;
      }),
    ).rejects.toThrow("two failed");
  });

  it("handles an empty input and rejects a non-positive limit", async () => {
    expect(await mapWithConcurrency([], 2, async (n) => n)).toEqual([]);
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toThrow(/positive integer/);
  });
});

describe("chunk", () => {
  it("splits into consecutive chunks of at most size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
