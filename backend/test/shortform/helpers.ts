import type { ScenePlan, SceneSpec, VerifiedAsset, VerifiedManifest } from "../../src/shortform/types";

export function makeAsset(over: Partial<VerifiedAsset> = {}): VerifiedAsset {
  return {
    id: "asset.test.v1",
    file: "ui/test.jpg",
    sha256: "0".repeat(64),
    width: 1000,
    height: 2000,
    kind: "phone_ui",
    dataset: "demo-a",
    source: "test",
    capturedAt: "2026-09-21",
    dataLabel: "EXAMPLE DATA",
    verifiedByOwner: true,
    topics: ["drawdown", "buffer"],
    chromeRegions: [{ x: 0, y: 0, w: 1000, h: 150 }],
    privateRegions: [],
    facts: [
      { key: "buffer", text: "Buffer $690.50", values: ["$690.50"], topics: ["buffer"], region: { x: 100, y: 400, w: 800, h: 200 } },
      { key: "limit", text: "Loss limit $1,200.00", values: ["$1,200.00"], topics: ["buffer"], region: { x: 100, y: 800, w: 800, h: 200 } },
    ],
    ...over,
  };
}

export function makeManifest(...assets: VerifiedAsset[]): VerifiedManifest {
  return { version: 1, note: "test", assets: assets.length ? assets : [makeAsset()] };
}

export function makeScene(over: Partial<SceneSpec> = {}): SceneSpec {
  return {
    sceneId: "s1",
    narration: "The buffer reads $690.50.",
    takeaway: "Read the buffer.",
    assetId: "asset.test.v1",
    focalRegion: { x: 100, y: 400, w: 800, h: 200 },
    crop: { x: 50, y: 300, w: 900, h: 800 },
    aspectRatio: "source",
    layout: "full_card",
    headline: "Buffer: $690.50",
    captionText: "This is the buffer.",
    durationSeconds: 5,
    transition: { type: "cut", durationSeconds: 0 },
    disclosure: "EXAMPLE DATA",
    cta: null,
    platform: "both",
    experimentId: "exp-1",
    variationId: "v-a",
    expectedTopics: ["buffer"],
    claims: [{ id: "c1", type: "data_point", text: "Buffer $690.50", evidence: [{ assetId: "asset.test.v1", factKey: "buffer" }] }],
    masks: [],
    ...over,
  };
}

export function closingScene(over: Partial<SceneSpec> = {}): SceneSpec {
  return makeScene({
    sceneId: "close",
    narration: "Follow for more.",
    takeaway: "Follow.",
    assetId: null,
    focalRegion: null,
    crop: null,
    headline: "Read the rule.",
    captionText: "Check your buffer.",
    disclosure: null,
    cta: "Follow @fillbookhq",
    claims: [{ id: "c-close", type: "invitation", text: "Follow", evidence: [] }],
    ...over,
  });
}

export function makePlan(scenes: SceneSpec[], over: Partial<ScenePlan> = {}): ScenePlan {
  return {
    planId: "plan-1",
    title: "Test plan",
    series: "Test series",
    topic: "topic",
    hook: "hook",
    experimentId: "exp-1",
    variationId: "v-a",
    platforms: ["tiktok", "youtube_shorts"],
    voice: "voice",
    visualStyle: "style",
    scenes,
    requiredAssets: [],
    ...over,
  };
}
