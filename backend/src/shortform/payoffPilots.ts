import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type Claim, type PayoffSpec, type Rect, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * The 2026-09 retention redesign, applied to the pilot with proven pull ("Read this before your first trade", the
 * Daily Brief). Every scene is a "payoff" scene: a big figure in frame one, at most 7 words on screen, ONE zoomed
 * element of the real product below it, a cut every ~2-3s, and an ending that leads straight back into the opening
 * line so the loop reads as one thought. Three variants differ only in how frame one looks (theme and motion), so a
 * 24-hour retention read can pick the winner: A bright + pop, B dark + pop, C bright + count-up.
 */
const REC = "rec.p7-daily-brief.v1";
const VOICE = "edge-tts en-US-AndrewMultilingualNeural (pipeline default; the owner may replace it)";
const VISUAL_STYLE = "payoff-zoom-card-v1";
const CLIP = { start: 2.0, end: 9.0 } as const;

export type PayoffVariant = "a" | "b" | "c";

interface Zoom {
  crop: Rect;
  focal: Rect;
  claim: Claim;
}

const BUFFER: Zoom = {
  crop: { x: 56, y: 500, w: 424, h: 112 },
  focal: { x: 70, y: 505, w: 405, h: 100 },
  claim: { id: "p7v2-c1", type: "data_point", text: "$1,725 of buffer to the floor.", evidence: [{ assetId: REC, factKey: "brief.buffer" }] },
};
const LAST_SESSION: Zoom = {
  crop: { x: 56, y: 328, w: 330, h: 112 },
  focal: { x: 70, y: 330, w: 290, h: 108 },
  claim: { id: "p7v2-c2", type: "data_point", text: "Last session: -$17 on 1 trade.", evidence: [{ assetId: REC, factKey: "brief.last_session_value" }] },
};
const LOSS_LIMIT: Zoom = {
  crop: { x: 492, y: 545, w: 384, h: 68 },
  focal: { x: 494, y: 552, w: 370, h: 52 },
  claim: { id: "p7v2-c3", type: "data_point", text: "$1,000 of today's loss limit.", evidence: [{ assetId: REC, factKey: "brief.loss_limit" }] },
};
const WINDOW_STATS: Zoom = {
  crop: { x: 456, y: 676, w: 344, h: 56 },
  focal: { x: 458, y: 680, w: 335, h: 48 },
  claim: { id: "p7v2-c4", type: "data_point", text: "Strongest window: 22 trades at a 64% win rate.", evidence: [{ assetId: REC, factKey: "brief.window_stats" }] },
};

const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;

export function pilot7PayoffPlan(variant: PayoffVariant): ScenePlan {
  const spec: PayoffSpec =
    variant === "a" ? { theme: "bright", motion: "pop" } : variant === "b" ? { theme: "dark", motion: "pop" } : { theme: "bright", motion: "count" };
  const variationId = `p7-pay-${variant}`;

  const base = (i: { sceneId: string; first?: boolean; narration: string; takeaway: string; headline: string; caption: string; seconds: number; disclosure: string; cta?: string }) => ({
    sceneId: i.sceneId,
    narration: i.narration,
    takeaway: i.takeaway,
    aspectRatio: "source" as const,
    layout: "payoff" as const,
    headline: i.headline,
    captionText: i.caption,
    durationSeconds: i.seconds,
    transition: i.first ? { type: "cut" as const, durationSeconds: 0 } : { type: "fade" as const, durationSeconds: 0.15 },
    disclosure: i.disclosure,
    cta: i.cta ?? null,
    platform: "both" as const,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    expectedTopics: ["daily_brief"],
    masks: [],
    payoff: spec,
  });
  const zoomScene = (i: Parameters<typeof base>[0], z: Zoom): SceneSpec => ({
    ...base(i),
    assetId: REC,
    focalRegion: z.focal,
    crop: z.crop,
    claims: [z.claim],
    clipTimeRangeSeconds: { ...CLIP },
  });
  const textScene = (i: Parameters<typeof base>[0], claims: Claim[]): SceneSpec => ({ ...base(i), assetId: null, focalRegion: null, crop: null, claims });

  return {
    planId: `pilot-7-payoff-${variant}`,
    title: "Read this before your first trade.",
    series: "What Your Journal Shows",
    topic: "A short brief of last session, remaining buffer and the strongest window before trading",
    hook: "$1,725 left before your floor.",
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    scenes: [
      zoomScene(
        { sceneId: "p7v2-s1-payoff", first: true, narration: "$1,725 left before your floor.", takeaway: "The number that matters before the first trade.", headline: "$1,725 left before your floor", caption: "Your buffer, before trade one.", seconds: 3.4, disclosure: "Demo data" },
        BUFFER,
      ),
      zoomScene(
        { sceneId: "p7v2-s2-last", narration: "Last session: a $17 loss.", takeaway: "Yesterday's result, in one line.", headline: "-$17 last session, on 1 trade", caption: "Your last session's result.", seconds: 2.4, disclosure: "Demo data" },
        LAST_SESSION,
      ),
      zoomScene(
        { sceneId: "p7v2-s3-limit", narration: "$1,000 of today's loss limit.", takeaway: "Room left before today's limit.", headline: "$1,000 of today's loss limit", caption: "Room left today.", seconds: 2.2, disclosure: "Demo data" },
        LOSS_LIMIT,
      ),
      zoomScene(
        { sceneId: "p7v2-s4-window", narration: "A 64% win rate. 22 trades.", takeaway: "Where the record is strongest.", headline: "64% win rate over 22 trades", caption: "Your strongest window.", seconds: 3.0, disclosure: "Demo data" },
        WINDOW_STATS,
      ),
      textScene(
        { sceneId: "p7v2-s5-qualify", narration: "This is a sample account with demo data. Yours will differ.", takeaway: "The brief is only as good as the trades and rules entered.", headline: "Sample account, not your numbers.", caption: "Built from logged trades and set limits.", seconds: 3.0, disclosure: "Demo data. Not investment advice." },
        [{ id: "p7v2-c5", type: "concept", text: "Qualifies that the brief comes from logged trades and configured rules, shown with demo data.", evidence: [] }],
      ),
      textScene(
        { sceneId: "p7v2-s6-close", narration: "Read this before your first trade. Try it free for 14 days on your own account.", takeaway: "Check your own numbers first.", headline: "Read this before your first trade.", caption: "Check your own numbers first.", seconds: 4.1, disclosure: "Demo data", cta: CTA },
        [{ id: "p7v2-c6", type: "invitation", text: "Invites the viewer to try it on their own account.", evidence: [] }],
      ),
    ],
  };
}

export const PAYOFF_PILOTS: ScenePlan[] = (["a", "b", "c"] as const).map(pilot7PayoffPlan);
