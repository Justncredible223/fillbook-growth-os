import { describe, expect, it } from "vitest";
import {
  CANVAS,
  layoutBoxes,
  rectContains,
  rectsIntersect,
  safeRect,
  textOverflows,
  validateCropBounds,
  validateOutputDimensions,
  validatePrivacyMasks,
  validateSceneFraming,
  validateSceneText,
} from "../../src/shortform/layout";
import { makeAsset, makeScene } from "./helpers";

const codes = (issues: Array<{ code: string }>) => issues.map((i) => i.code);

describe("crop bounds", () => {
  const asset = makeAsset();
  it("rejects a crop that runs past the image", () => {
    expect(codes(validateCropBounds({ x: 800, y: 0, w: 400, h: 400 }, asset, "s"))).toContain("invalid_crop_bounds");
    expect(codes(validateCropBounds({ x: 0, y: 1900, w: 400, h: 400 }, asset, "s"))).toContain("invalid_crop_bounds");
  });
  it("rejects negative, fractional, non-finite and too-small crops", () => {
    expect(validateCropBounds({ x: -1, y: 0, w: 300, h: 300 }, asset, "s")).not.toHaveLength(0);
    expect(validateCropBounds({ x: 0.5, y: 0, w: 300, h: 300 }, asset, "s")).not.toHaveLength(0);
    expect(validateCropBounds({ x: 0, y: 0, w: Number.NaN, h: 300 }, asset, "s")).not.toHaveLength(0);
    expect(validateCropBounds({ x: 0, y: 0, w: 100, h: 300 }, asset, "s")).not.toHaveLength(0);
  });
  it("requires a crop at all", () => {
    expect(codes(validateCropBounds(null, asset, "s"))).toEqual(["missing_crop"]);
  });
  it("accepts a valid crop", () => {
    expect(validateCropBounds({ x: 50, y: 300, w: 900, h: 800 }, asset, "s")).toEqual([]);
  });
});

describe("output dimensions", () => {
  it("accepts only 1080x1920", () => {
    expect(validateOutputDimensions(1080, 1920)).toEqual([]);
    for (const [w, h] of [[1920, 1080], [720, 1280], [1080, 1350], [1080, 1921]]) {
      expect(codes(validateOutputDimensions(w!, h!))).toEqual(["unsupported_output_dimensions"]);
    }
  });
});

describe("safe areas and fixed text boxes", () => {
  it("every box sits inside the platform safe area, does not overlap another, and the media box is usable", () => {
    for (const platform of ["tiktok", "youtube_shorts"] as const) {
      const b = layoutBoxes(platform);
      const safe = safeRect(platform);
      for (const box of [b.headline, b.media, b.disclosure, b.caption]) expect(rectContains(safe, box)).toBe(true);
      const boxes = [b.headline, b.media, b.disclosure, b.caption];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(rectsIntersect(boxes[i]!, boxes[j]!)).toBe(false);
      expect(b.media.h).toBeGreaterThan(600);
      expect(safe.x + safe.w).toBeLessThanOrEqual(CANVAS.width);
    }
  });
});

describe("caption overflow and text limits", () => {
  it("flags a caption that does not fit its box", () => {
    const long = makeScene({ captionText: "word ".repeat(21).trim() });
    expect(codes(validateSceneText(long))).toContain("caption_overflow");
  });
  it("flags a headline that is too long or overflows", () => {
    const s = makeScene({ headline: "This headline is far too long to sit on two lines at this size" });
    const found = codes(validateSceneText(s));
    expect(found).toContain("headline_too_long");
    expect(found).toContain("headline_overflow");
  });
  it("flags a single word wider than the box", () => {
    expect(textOverflows("Supercalifragilisticexpialidocious", 76, layoutBoxes("tiktok").headline)).toBe(true);
  });
  it("enforces minimum readable font sizes", () => {
    const found = codes(validateSceneText(makeScene({ fontSizes: { headline: 40, caption: 30 } })));
    expect(found).toContain("headline_font_too_small");
    expect(found).toContain("caption_font_too_small");
  });
  it("accepts text that fits at the default sizes", () => {
    expect(validateSceneText(makeScene())).toEqual([]);
  });
  it("rejects an email-like identifier in any on-screen or spoken text", () => {
    expect(codes(validateSceneText(makeScene({ captionText: "Ask trader@example.com" })))).toContain("personal_identifier_in_text");
    expect(validateSceneText(makeScene({ captionText: "Follow @fillbookhq" }))).toEqual([]);
  });
});

describe("framing: no stretch, chrome, sidebar, focal region", () => {
  const asset = makeAsset();
  it("rejects a crop that includes the app header", () => {
    expect(codes(validateSceneFraming(makeScene({ crop: { x: 0, y: 100, w: 900, h: 900 }, focalRegion: { x: 100, y: 400, w: 200, h: 200 } }), asset))).toContain("crop_includes_app_chrome");
    expect(codes(validateSceneFraming(makeScene({ crop: { x: 0, y: 100, w: 900, h: 900 }, focalRegion: { x: 100, y: 400, w: 200, h: 200 }, allowChrome: true }), asset))).not.toContain("crop_includes_app_chrome");
  });
  it("requires a focal region inside the crop", () => {
    expect(codes(validateSceneFraming(makeScene({ focalRegion: null }), asset))).toContain("missing_focal_region");
    expect(codes(validateSceneFraming(makeScene({ focalRegion: { x: 0, y: 1500, w: 100, h: 100 } }), asset))).toContain("focal_region_outside_crop");
  });
  it('rejects layout "fill" with a crop that would need stretching, accepts one with the frame aspect', () => {
    expect(codes(validateSceneFraming(makeScene({ layout: "fill", crop: { x: 50, y: 300, w: 900, h: 800 } }), asset))).toContain("crop_would_stretch_or_crop");
    const frame = layoutBoxes("tiktok").media;
    const h = 500;
    const w = Math.round((frame.w / frame.h) * h);
    const ok = validateSceneFraming(makeScene({ layout: "fill", crop: { x: 100, y: 300, w, h }, focalRegion: { x: 150, y: 350, w: 100, h: 100 } }), asset);
    expect(codes(ok)).not.toContain("crop_would_stretch_or_crop");
  });
  it("rejects a declared aspect ratio the crop does not match", () => {
    expect(codes(validateSceneFraming(makeScene({ aspectRatio: "9:16" }), asset))).toContain("crop_aspect_mismatch");
  });
  it("never distorts: the placed size keeps the crop's aspect ratio (uniform scale)", async () => {
    const { placeMedia } = await import("../../src/shortform/previewRender");
    const p = placeMedia(makeScene())!;
    expect(p.width / p.height).toBeCloseTo(900 / 800, 2);
  });
  it("flags a crop enlarged too far as blurry", () => {
    const tiny = makeScene({ crop: { x: 50, y: 300, w: 200, h: 200 }, focalRegion: { x: 60, y: 310, w: 100, h: 100 } });
    expect(codes(validateSceneFraming(tiny, asset))).toEqual(expect.arrayContaining(["crop_too_blurry"]));
  });
  it("desktop screenshots: never fill, remove the sidebar, never a whole page", () => {
    const desktop = makeAsset({ id: "d", kind: "desktop_ui", width: 2000, height: 1200, chromeRegions: [], sidebarRegion: { x: 0, y: 0, w: 300, h: 1200 }, facts: [] });
    const withSidebar = makeScene({ assetId: "d", crop: { x: 0, y: 100, w: 1200, h: 700 }, focalRegion: { x: 400, y: 200, w: 200, h: 200 } });
    expect(codes(validateSceneFraming(withSidebar, desktop))).toContain("sidebar_not_removed");
    const filled = makeScene({ assetId: "d", layout: "fill", crop: { x: 400, y: 100, w: 800, h: 700 }, focalRegion: { x: 450, y: 150, w: 100, h: 100 } });
    expect(codes(validateSceneFraming(filled, desktop))).toContain("desktop_screenshot_not_card");
    const whole = makeScene({ assetId: "d", crop: { x: 0, y: 0, w: 2000, h: 1200 }, focalRegion: { x: 400, y: 200, w: 200, h: 200 }, keepSidebar: true });
    expect(codes(validateSceneFraming(whole, desktop))).toContain("full_desktop_page");
    const good = makeScene({ assetId: "d", crop: { x: 400, y: 100, w: 1000, h: 600 }, focalRegion: { x: 450, y: 150, w: 100, h: 100 } });
    expect(validateSceneFraming(good, desktop).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("privacy masks", () => {
  const withEmail = makeAsset({ privateRegions: [{ kind: "email", region: { x: 300, y: 500, w: 400, h: 60 } }] });
  it("requires a mask that fully covers a private region the crop reveals", () => {
    expect(codes(validatePrivacyMasks(makeScene(), withEmail))).toContain("unmasked_private_region");
    const partial = makeScene({ masks: [{ region: { x: 300, y: 500, w: 200, h: 60 } }] });
    expect(codes(validatePrivacyMasks(partial, withEmail))).toContain("unmasked_private_region");
    const full = makeScene({ masks: [{ region: { x: 290, y: 490, w: 420, h: 80 } }] });
    expect(codes(validatePrivacyMasks(full, withEmail))).not.toContain("unmasked_private_region");
  });
  it("does not require a mask when the crop does not reveal the region", () => {
    const away = makeScene({ crop: { x: 50, y: 1100, w: 900, h: 800 }, focalRegion: { x: 100, y: 1200, w: 100, h: 100 } });
    expect(validatePrivacyMasks(away, withEmail)).toEqual([]);
  });
  it("warns about a mask that hides nothing", () => {
    const stray = makeScene({ masks: [{ region: { x: 100, y: 1500, w: 100, h: 100 } }] });
    expect(codes(validatePrivacyMasks(stray, makeAsset()))).toContain("mask_outside_crop");
    const notOnPrivate = makeScene({ masks: [{ region: { x: 100, y: 400, w: 100, h: 100 } }] });
    expect(codes(validatePrivacyMasks(notOnPrivate, makeAsset()))).toContain("mask_not_on_private_region");
  });
  it("places a mask at the right canvas position (source coordinates mapped through the crop and scale)", async () => {
    const { placeMedia } = await import("../../src/shortform/previewRender");
    const scene = makeScene({ masks: [{ region: { x: 290, y: 490, w: 420, h: 80 } }] });
    const p = placeMedia(scene)!;
    const box = p.maskBoxes[0]!;
    expect(box.x).toBe(Math.round(p.x + (290 - 50) * p.scale));
    expect(box.y).toBe(Math.round(p.y + (490 - 300) * p.scale));
    expect(box.w).toBe(Math.round(420 * p.scale));
    // The masked region on canvas sits inside the placed screenshot.
    expect(box.x).toBeGreaterThanOrEqual(p.x);
    expect(box.x + box.w).toBeLessThanOrEqual(p.x + p.width + 1);
  });
});
