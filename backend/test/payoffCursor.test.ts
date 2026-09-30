import { describe, it, expect } from "vitest";
import { PAYOFF_PILOTS } from "../src/shortform/payoffPilots";
import { computePayoffCard } from "../src/shortform/payoffLayout";
import { buildPayoffCursorCues, payoffCursorTarget } from "../scripts/video-factory/payoffCues";
import { buildAssFile } from "../scripts/video-factory/captions";
import { PLATFORM_OVERLAY_ZONES } from "../scripts/video-factory/render";

const evidenceScenes = PAYOFF_PILOTS[0]!.scenes.filter((s) => s.assetId);

describe("payoff pointer", () => {
  it("is switched on for every evidence scene of every variant, and only evidence scenes get one", () => {
    for (const plan of PAYOFF_PILOTS) {
      for (const s of plan.scenes) expect(s.payoff?.cursor).toBe(true);
    }
    expect(evidenceScenes.length).toBe(4);
  });

  it("lands inside the card's own lower-right, never over the figure's start, and inside the safe area", () => {
    for (const s of evidenceScenes) {
      const card = computePayoffCard(s.crop!);
      const to = payoffCursorTarget({ card, crop: s.crop!, focal: s.focalRegion! });
      expect(to.x).toBeGreaterThanOrEqual(card.x);
      expect(to.x).toBeLessThanOrEqual(card.x + card.width);
      expect(to.y).toBeGreaterThanOrEqual(card.y);
      // The arrow is about 40 x 62px, so its tip must leave room before the button column and the caption area.
      expect(to.x + 40).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.rightColumn.x);
      expect(to.y + 62).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.captionTop);
    }
  });

  it("glides in from the lower right and stays inside the safe area the whole way", () => {
    for (const s of evidenceScenes) {
      const card = computePayoffCard(s.crop!);
      const [pointer] = buildPayoffCursorCues({ card, crop: s.crop!, focal: s.focalRegion!, start: 1, end: 4 });
      const m = pointer!.text.match(/\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)/);
      expect(m).not.toBeNull();
      const [x1, y1, x2, y2] = m!.slice(1, 5).map(Number) as [number, number, number, number];
      expect(x1).toBeGreaterThanOrEqual(x2);
      expect(y1).toBeGreaterThanOrEqual(y2);
      for (const x of [x1, x2]) expect(x + 40).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.rightColumn.x);
      for (const y of [y1, y2]) expect(y + 62).toBeLessThanOrEqual(PLATFORM_OVERLAY_ZONES.captionTop);
    }
  });

  it("fades in after the scene opens, pulses a ring where it lands, and draws above the text", () => {
    const s = evidenceScenes[0]!;
    const cues = buildPayoffCursorCues({ card: computePayoffCard(s.crop!), crop: s.crop!, focal: s.focalRegion!, start: 2, end: 5 });
    expect(cues).toHaveLength(2);
    const [pointer, ripple] = cues as [(typeof cues)[number], (typeof cues)[number]];
    expect(pointer.startSeconds).toBeGreaterThan(2);
    expect(pointer.endSeconds).toBe(5);
    expect(ripple.startSeconds).toBeGreaterThan(pointer.startSeconds);
    expect(ripple.endSeconds - ripple.startSeconds).toBeLessThan(0.6);
    expect(pointer.layer!).toBeGreaterThan(0);
    expect(pointer.layer!).toBeGreaterThan(ripple.layer!);
  });

  it("writes the pointer on a higher ASS layer than the headline text", () => {
    const s = evidenceScenes[0]!;
    const [pointer, ripple] = buildPayoffCursorCues({ card: computePayoffCard(s.crop!), crop: s.crop!, focal: s.focalRegion!, start: 0, end: 3 });
    const ass = buildAssFile(
      [{ text: "$1,725", startSeconds: 0, endSeconds: 3, style: "Pay", marginV: 380 }, pointer!, ripple!],
      [],
    );
    const layers = ass.split("\n").filter((l) => l.startsWith("Dialogue:")).map((l) => Number(l.split(":")[1]!.split(",")[0]));
    expect(layers).toEqual([0, 5, 4]);
  });
});
