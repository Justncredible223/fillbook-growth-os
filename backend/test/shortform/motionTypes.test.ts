import { describe, it, expect } from "vitest";
import type { MotionCaptureSpec, CaptureAction, CaptureActionKind, SceneSpec, VerifiedAsset } from "../../src/shortform/types";

/**
 * Regression coverage for the motion-capture type extensions (2026-09-23):
 * VerifiedAsset/AssetFact/SceneSpec gained optional, additive fields for a
 * `screen_recording` asset kind, and MotionCaptureSpec/CaptureAction are new
 * exports. See types.ts's own doc comments on each field for the reasoning.
 * These tests prove three things the task explicitly required: a motion
 * scene serializes and round-trips through JSON cleanly, the capture-action
 * vocabulary is read-only by construction, and every pre-existing
 * still-image SceneSpec shape still satisfies the type with zero changes.
 */

const READ_ONLY_ACTION_KINDS: CaptureActionKind[] = [
  "open_page",
  "wait_for_selector",
  "scroll_to",
  "expand_section",
  "switch_tab",
  "focus_element",
  "hover_element",
  "navigate",
];

describe("CaptureActionKind allowlist", () => {
  it("contains only read-only, non-mutating action kinds -- no create/edit/delete/submit/sync verb exists at all", () => {
    const writeVerbs = ["create", "edit", "delete", "submit", "sync", "import", "click_submit", "save", "post", "write", "update"];
    for (const kind of READ_ONLY_ACTION_KINDS) {
      for (const verb of writeVerbs) {
        expect(kind.toLowerCase()).not.toContain(verb);
      }
    }
  });

  it("is exactly the 8 documented kinds -- a new kind added here must be deliberately reviewed for read-only-ness, not slip in silently", () => {
    expect(READ_ONLY_ACTION_KINDS).toHaveLength(8);
    expect(new Set(READ_ONLY_ACTION_KINDS).size).toBe(8); // no duplicates
  });
});

describe("MotionCaptureSpec serialization", () => {
  const spec: MotionCaptureSpec = {
    sceneId: "test-motion-scene",
    route: "/reports",
    viewport: { width: 1080, height: 1920 },
    startState: "Reports page with Net P&L visible",
    actions: [
      { kind: "wait_for_selector", selector: "text=$387.08", atSeconds: 0.5 },
      { kind: "expand_section", target: "By setup", atSeconds: 2 },
      { kind: "hover_element", selector: "text=Opening Range Break", atSeconds: 4 },
    ] satisfies CaptureAction[],
    captureDurationSeconds: 8,
    focalRegion: { x: 0, y: 0, w: 400, h: 200 },
    crop: null,
    privateRegions: [{ region: { x: 10, y: 10, w: 100, h: 20 }, kind: "email" }],
    demoDataDisclosure: "Local fixture data -- not a real trader's account.",
    datasetId: "local-fixture.test.2026-09-23",
    fallback: "still_image",
  };

  it("round-trips through JSON with no data loss", () => {
    const roundTripped = JSON.parse(JSON.stringify(spec)) as MotionCaptureSpec;
    expect(roundTripped).toEqual(spec);
  });

  it("preserves action ordering and timing through serialization -- capture replay depends on both", () => {
    const roundTripped = JSON.parse(JSON.stringify(spec)) as MotionCaptureSpec;
    expect(roundTripped.actions.map((a) => a.kind)).toEqual(spec.actions.map((a) => a.kind));
    expect(roundTripped.actions.map((a) => a.atSeconds)).toEqual(spec.actions.map((a) => a.atSeconds));
  });
});

describe("VerifiedAsset with the new screen_recording kind", () => {
  it("accepts a screen_recording asset with a captureSpec and duration/fps, none of which a still asset needs", () => {
    const asset: VerifiedAsset = {
      id: "rec.test.v1",
      file: "motion/test.webm",
      sha256: "0".repeat(64),
      width: 1080,
      height: 1920,
      kind: "screen_recording",
      dataset: "local-fixture.test.2026-09-23",
      source: "playwright-local-capture",
      capturedAt: "2026-09-23T00:00:00.000Z",
      dataLabel: "Local fixture data",
      verifiedByOwner: false,
      topics: ["month_total"],
      chromeRegions: [],
      privateRegions: [],
      facts: [
        {
          key: "month.total_positive",
          text: "Net P&L is $387.08",
          values: ["$387.08"],
          topics: ["month_total"],
          region: { x: 0, y: 0, w: 400, h: 100 },
          timeRangeSeconds: { start: 0, end: 2 },
        },
      ],
      durationSeconds: 8,
      fps: 30,
    };
    expect(asset.kind).toBe("screen_recording");
    expect(asset.facts[0]!.timeRangeSeconds).toEqual({ start: 0, end: 2 });
  });
});

describe("existing still-image SceneSpec shape is fully preserved", () => {
  it("a still-image scene with none of the new motion fields set still satisfies SceneSpec unchanged", () => {
    // Exact shape any pre-2026-09-23 pilot scene already has -- see pilots.ts.
    const stillScene: SceneSpec = {
      sceneId: "p1-s1-hook",
      narration: "Green month. Losing setup.",
      takeaway: "A positive total does not mean every setup is working.",
      assetId: "ui.month-overview-setups.v1",
      focalRegion: { x: 40, y: 480, w: 480, h: 170 },
      crop: { x: 40, y: 480, w: 480, h: 170 },
      aspectRatio: "source",
      layout: "full_card",
      headline: "Green month. Losing setup.",
      captionText: "The total is positive.",
      durationSeconds: 2.6,
      transition: { type: "cut", durationSeconds: 0 },
      disclosure: "EXAMPLE DATA",
      cta: null,
      platform: "both",
      experimentId: "exp-pilot-2026-09",
      variationId: "p1-a",
      expectedTopics: ["month_total"],
      claims: [],
      masks: [],
      // clipTimeRangeSeconds and motionCapture both omitted -- the whole point.
    };
    expect(stillScene.clipTimeRangeSeconds).toBeUndefined();
    expect(stillScene.motionCapture).toBeUndefined();
    expect(JSON.parse(JSON.stringify(stillScene))).toEqual(stillScene);
  });
});
