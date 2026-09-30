import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type Claim, type PayoffSpec, type Rect, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * Story rebuilds: concepts rewritten so they clear the render bar (storyScore.ts, A or A+ only). Each keeps the verified
 * recording and facts of the pilot it rebuilds, and changes what the video SAYS: one idea, plain words, a turn, a
 * payoff, and an ending that leads straight back into the hook.
 *
 * "Best day ever: +$3,100. Then -$3,060." (rebuild of pilot 20, the trailing floor). Beats:
 *   1. hook      the best day, in one number
 *   2. contrast  the worst day, in one number
 *   3. plain     what a trailing floor is, in words a stranger knows
 *   4. so        the account sits $60 under its floor
 *   5. stakes    most firms close an account at that point
 *   6. loop      the hook again, and one thing to do
 */
const REC = "rec.hs-trailing-account.v1";
const VOICE = "edge-tts en-US-AndrewMultilingualNeural (pipeline default; the owner may replace it)";
const VISUAL_STYLE = "payoff-zoom-card-v1";
const CALENDAR_CLIP = { start: 2.0, end: 7.0 } as const;
const FLOOR_CLIP = { start: 17.3, end: 24.0 } as const;

interface Zoom {
  crop: Rect;
  focal: Rect;
  claim: Claim;
}

const BEST_DAY: Zoom = {
  crop: { x: 84, y: 1230, w: 346, h: 96 },
  focal: { x: 88, y: 1236, w: 180, h: 84 },
  claim: { id: "p20s-c1", type: "data_point", text: "Best day: $3,100.00.", evidence: [{ assetId: REC, factKey: "dashboard.best_day" }] },
};
const WORST_DAY: Zoom = {
  crop: { x: 500, y: 1230, w: 346, h: 96 },
  focal: { x: 546, y: 1236, w: 200, h: 84 },
  claim: { id: "p20s-c2", type: "data_point", text: "Worst day: -$3,060.00.", evidence: [{ assetId: REC, factKey: "dashboard.worst_day" }] },
};
const FLOOR_BUFFER: Zoom = {
  crop: { x: 70, y: 160, w: 388, h: 96 },
  focal: { x: 78, y: 166, w: 370, h: 84 },
  claim: { id: "p20s-c4", type: "data_point", text: "$-60 of buffer to the floor: the account is $60 under its floor.", evidence: [{ assetId: REC, factKey: "dashboard.floor_buffer" }] },
};
const BELOW_FLOOR: Zoom = {
  crop: { x: 70, y: 620, w: 454, h: 50 },
  focal: { x: 78, y: 626, w: 446, h: 40 },
  claim: { id: "p20s-c5", type: "data_point", text: "The app flags it: equity is below the trailing floor.", evidence: [{ assetId: REC, factKey: "dashboard.equity_below_floor" }] },
};

const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;
const SPEC: PayoffSpec = { theme: "bright", motion: "pop", cursor: true };
const WORDS_SPEC: PayoffSpec = { ...SPEC, leadWithWords: true };

export function pilot20StoryPlan(): ScenePlan {
  const variationId = "p20-story-a";
  type Input = { sceneId: string; first?: boolean; narration: string; takeaway: string; headline: string; caption: string; seconds: number; disclosure: string; cta?: string; spec?: PayoffSpec };
  const base = (i: Input) => ({
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
    expectedTopics: ["trailing_drawdown"],
    masks: [],
    payoff: i.spec ?? SPEC,
  });
  const zoom = (i: Input, z: Zoom, clip: { start: number; end: number }): SceneSpec => ({
    ...base(i),
    assetId: REC,
    focalRegion: z.focal,
    crop: z.crop,
    claims: [z.claim],
    clipTimeRangeSeconds: { ...clip },
  });
  const words = (i: Input, claims: Claim[]): SceneSpec => ({ ...base(i), assetId: null, focalRegion: null, crop: null, claims });

  return {
    planId: "pilot-20-story-a",
    title: "Why a +$3,100 day still ended under the floor",
    series: "Read the Rule",
    topic: "A trailing drawdown floor is set by an account's best day, so a huge win can leave an account closer to its floor",
    hook: "Best day ever: +$3,100. Then -$3,060.",
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    scenes: [
      zoom(
        { sceneId: "p20s-s1-hook", first: true, narration: "Best day ever: plus $3,100.", takeaway: "The account's best day.", headline: "+$3,100. Best day ever.", caption: "The best single day.", seconds: 2.6, disclosure: "Demo data" },
        BEST_DAY, CALENDAR_CLIP,
      ),
      zoom(
        { sceneId: "p20s-s2-contrast", narration: "Then the worst: minus $3,060.", takeaway: "Four days later, the worst day.", headline: "-$3,060. Then this.", caption: "The worst single day.", seconds: 2.4, disclosure: "Demo data" },
        WORST_DAY, CALENDAR_CLIP,
      ),
      words(
        { sceneId: "p20s-s3-plain", narration: "A trailing floor follows your peak, not your balance.", takeaway: "What a trailing floor is.", headline: "The floor follows your peak.", caption: "Not your balance.", seconds: 3.0, disclosure: "Demo data", spec: WORDS_SPEC },
        [{ id: "p20s-c3", type: "concept", text: "A trailing drawdown floor is set by the account's own peak, not by today's balance.", evidence: [] }],
      ),
      zoom(
        { sceneId: "p20s-s4-so", narration: "So this account sits $60 under its floor.", takeaway: "Net positive, and still under the floor.", headline: "$60 under the floor.", caption: "Still up on the month.", seconds: 2.8, disclosure: "Demo data" },
        FLOOR_BUFFER, FLOOR_CLIP,
      ),
      zoom(
        { sceneId: "p20s-s5-stakes", narration: "Below the floor, most firms close the account.", takeaway: "Why it matters.", headline: "Most firms close it there.", caption: "Check your own firm's rule.", seconds: 2.8, disclosure: "Demo data", spec: WORDS_SPEC },
        BELOW_FLOOR, FLOOR_CLIP,
      ),
      words(
        { sceneId: "p20s-s6-close", narration: "Best day, then worst day. Know where your floor is before your next trade.", takeaway: "Know your floor before the next trade.", headline: "+$3,100. Then -$3,060.", caption: "Know your floor before your next trade.", seconds: 4.4, disclosure: "Demo data", cta: CTA },
        [{ id: "p20s-c6", type: "invitation", text: "Invites the viewer to try it on their own account.", evidence: [] }],
      ),
    ],
  };
}

export const STORY_PILOTS: ScenePlan[] = [pilot20StoryPlan()];
