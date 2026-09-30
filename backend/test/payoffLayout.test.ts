import { describe, it, expect } from "vitest";
import { PAYOFF, computePayoffCard, countUpFrames, payoffWordCount, splitPayoffHeadline } from "../src/shortform/payoffLayout";
import { PLATFORM_OVERLAY_ZONES } from "../scripts/video-factory/render";

describe("splitPayoffHeadline", () => {
  it("splits a leading figure from its line", () => {
    expect(splitPayoffHeadline("$1,725 left before your floor")).toEqual({ big: "$1,725", line: "left before your floor" });
    expect(splitPayoffHeadline("-$17 last session, on 1 trade")).toEqual({ big: "-$17", line: "last session, on 1 trade" });
    expect(splitPayoffHeadline("64% win rate over 22 trades")).toEqual({ big: "64%", line: "win rate over 22 trades" });
    expect(splitPayoffHeadline("−$17 last session")?.big).toBe("−$17");
  });

  it("returns null when the headline starts with a word, not a figure", () => {
    expect(splitPayoffHeadline("Read this before your first trade.")).toBeNull();
    expect(splitPayoffHeadline("Sample account, not your numbers.")).toBeNull();
  });

  it("counts words on screen, the figure counting as one", () => {
    expect(payoffWordCount("$1,725 left before your floor")).toBe(5);
    expect(payoffWordCount("  64%   win rate over 22 trades ")).toBe(6);
  });
});

describe("computePayoffCard", () => {
  const crops = [
    { w: 424, h: 112 },
    { w: 330, h: 112 },
    { w: 384, h: 68 },
    { w: 344, h: 56 },
    { w: 1004, h: 712 },
    { w: 300, h: 900 },
  ];

  it("keeps every card clear of the platforms' button column and caption area", () => {
    for (const crop of crops) {
      const card = computePayoffCard(crop);
      expect(card.x + card.width).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.rightColumn.x);
      expect(card.y + card.height).toBeLessThanOrEqual(PAYOFF.cardMaxBottom);
      expect(card.y + card.height).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.captionTop);
      expect(card.y).toBeGreaterThanOrEqual(PAYOFF.cardTop);
    }
  });

  it("never enlarges a crop past the soft-pixel limit and keeps its aspect", () => {
    for (const crop of crops) {
      const card = computePayoffCard(crop);
      expect(card.scale).toBeLessThanOrEqual(PAYOFF.upscaleMax + 1e-9);
      expect(Math.abs(card.width / card.height - crop.w / crop.h) / (crop.w / crop.h)).toBeLessThan(0.03);
    }
  });

  it("gives an even pixel size so the encoder never rounds a card edge", () => {
    for (const crop of crops) {
      const card = computePayoffCard(crop);
      expect(card.width % 2).toBe(0);
      expect(card.height % 2).toBe(0);
    }
  });

  it("puts the text block above the card", () => {
    expect(PAYOFF.textTop).toBeLessThan(PAYOFF.cardTop);
    expect(PAYOFF.textBottomLimit).toBeLessThanOrEqual(PAYOFF.cardTop);
  });
});

describe("countUpFrames", () => {
  it("ends exactly on the figure and never overshoots it", () => {
    for (const big of ["$1,725", "-$17", "64%", "22", "$1,504.04"]) {
      const frames = countUpFrames(big, 9);
      expect(frames).toHaveLength(9);
      expect(frames[frames.length - 1]).toBe(big);
    }
  });

  it("counts up monotonically from part of the way, keeping sign, dollar sign, commas and suffix", () => {
    const frames = countUpFrames("$1,725", 9, 0.6);
    const values = frames.map((f) => Number(f.replace(/[$,]/g, "")));
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    expect(values[0]!).toBeGreaterThanOrEqual(1725 * 0.6 - 1);
    expect(frames.every((f) => f.startsWith("$"))).toBe(true);
    expect(countUpFrames("-$17", 5).every((f) => f.startsWith("-$"))).toBe(true);
    expect(countUpFrames("64%", 5).every((f) => f.endsWith("%"))).toBe(true);
  });

  it("returns a non-numeric figure unchanged", () => {
    expect(countUpFrames("n/a", 5)).toEqual(["n/a"]);
  });
});
