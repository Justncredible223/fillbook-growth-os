import { describe, expect, it } from "vitest";
import { buildFilterComplex, buildSceneAss, placeMedia } from "../../src/shortform/previewRender";
import { closingScene, makeScene } from "./helpers";

describe("placeMedia: uniform scale, never distorted", () => {
  it("keeps the crop's own aspect ratio when placed", () => {
    const p = placeMedia(makeScene())!;
    expect(p.width / p.height).toBeCloseTo(900 / 800, 2);
  });
  it("returns null for a text-only scene", () => {
    expect(placeMedia(closingScene())).toBeNull();
  });
  it("rounds placed dimensions to even pixels for the encoder", () => {
    const p = placeMedia(makeScene())!;
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
  });
});

describe("buildSceneAss", () => {
  it("includes the headline, caption and disclosure text, escaped for ASS", () => {
    const ass = buildSceneAss(makeScene({ headline: "100% {weird}" }), { label: "S1" });
    expect(ass).toContain("100% (weird)");
    expect(ass).toContain("This is the buffer.");
    expect(ass).toContain("EXAMPLE DATA");
  });
  it("shows a loud missing-asset placeholder when told to", () => {
    const ass = buildSceneAss(makeScene(), { label: "S1", missingAssetId: "ui.needed.v1" });
    expect(ass).toContain("MISSING ASSET");
    expect(ass).toContain("ui.needed.v1");
  });
  it("includes the watermark so a preview can never be mistaken for a finished video", () => {
    const ass = buildSceneAss(makeScene(), { label: "S1", watermark: "PREVIEW ONLY" });
    expect(ass).toContain("PREVIEW ONLY");
  });
  it("is valid enough ASS structure for ffmpeg (has Script Info, Styles and Events sections)", () => {
    const ass = buildSceneAss(makeScene(), { label: "S1" });
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("[Events]");
  });
});

describe("buildFilterComplex", () => {
  it("scales and crops the source uniformly, then overlays it (no stretch filter)", () => {
    const p = placeMedia(makeScene())!;
    const graph = buildFilterComplex(p, { assFile: "s.ass", fontsDir: "fonts" });
    expect(graph).toContain(`crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y}`);
    expect(graph).toContain(`scale=${p.width}:${p.height}`);
    expect(graph).toContain("overlay=");
  });
  it("draws a mask box for every mask", () => {
    const scene = makeScene({ masks: [{ region: { x: 60, y: 410, w: 100, h: 40 } }] });
    const p = placeMedia(scene)!;
    const graph = buildFilterComplex(p, { assFile: "s.ass", fontsDir: "fonts" });
    expect((graph.match(/drawbox/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  it("draws a placeholder card when there is no placement (missing asset)", () => {
    const graph = buildFilterComplex(null, { assFile: "s.ass", fontsDir: "fonts", placeholderBox: { x: 60, y: 200, w: 900, h: 900 } });
    expect(graph).toContain("drawbox");
    expect(graph).not.toContain("overlay=");
  });
});
