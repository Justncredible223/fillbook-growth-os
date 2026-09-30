import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type Claim, type PayoffSpec, type Rect, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * More story rebuilds (see storyPilots.ts for the pattern and storyScore.ts for the bar): the high-stakes batch
 * rewritten so each one is a single idea with a hook, a plain-words explanation, a turn and a loop back. Each keeps the
 * verified recording of the pilot it rebuilds; only what the video says, and which one line it zooms on, changes.
 *
 *   pilot-19-story-a  "17 green days. One -$1,504 loss."           the payout the gap to a target hangs on
 *   pilot-21-story-a  "10 green days in a row. Still not done."    98% of the way, and what the target is
 *   pilot-22-story-a  "One trade. Two accounts. Both lost $1,201." one signal, two accounts, the loss twice
 */
const VOICE = "edge-tts en-US-AndrewMultilingualNeural (pipeline default; the owner may replace it)";
const VISUAL_STYLE = "payoff-zoom-card-v1";
const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;
const SPEC: PayoffSpec = { theme: "bright", motion: "pop", cursor: true };
const WORDS_SPEC: PayoffSpec = { ...SPEC, leadWithWords: true };

interface Zoom {
  assetId: string;
  crop: Rect;
  focal: Rect;
  claim: Claim;
  clip: { start: number; end: number };
}

interface SceneInput {
  sceneId: string;
  narration: string;
  takeaway: string;
  headline: string;
  caption: string;
  seconds: number;
  cta?: string;
  /** Evidence scene: the one line of the recording it zooms on. Omitted for a words-only scene. */
  zoom?: Zoom;
  /** Words-only scenes carry this concept claim instead. */
  claimText?: string;
  claimType?: "concept" | "invitation";
  /** True when an evidence scene leads with words rather than a figure (never the hook). */
  leadWithWords?: boolean;
}

interface StoryConfig {
  planId: string;
  title: string;
  series: string;
  topic: string;
  hook: string;
  variationId: string;
  expectedTopic: string;
  scenes: SceneInput[];
}

function buildStoryPlan(cfg: StoryConfig): ScenePlan {
  const scenes: SceneSpec[] = cfg.scenes.map((s, i) => {
    const spec = s.zoom ? (s.leadWithWords ? WORDS_SPEC : SPEC) : WORDS_SPEC;
    const common = {
      sceneId: s.sceneId,
      narration: s.narration,
      takeaway: s.takeaway,
      aspectRatio: "source" as const,
      layout: "payoff" as const,
      headline: s.headline,
      captionText: s.caption,
      durationSeconds: s.seconds,
      transition: i === 0 ? { type: "cut" as const, durationSeconds: 0 } : { type: "fade" as const, durationSeconds: 0.15 },
      disclosure: "Demo data",
      cta: s.cta ?? null,
      platform: "both" as const,
      experimentId: PILOT_EXPERIMENT_ID,
      variationId: cfg.variationId,
      expectedTopics: [cfg.expectedTopic],
      masks: [],
      payoff: spec,
    };
    if (s.zoom) {
      return { ...common, assetId: s.zoom.assetId, focalRegion: s.zoom.focal, crop: s.zoom.crop, claims: [s.zoom.claim], clipTimeRangeSeconds: { ...s.zoom.clip } };
    }
    const claim: Claim = { id: `${cfg.variationId}-c${i + 1}`, type: s.claimType ?? "concept", text: s.claimText ?? "A plain-words point that makes no claim about the product.", evidence: [] };
    return { ...common, assetId: null, focalRegion: null, crop: null, claims: [claim] };
  });
  return {
    planId: cfg.planId,
    title: cfg.title,
    series: cfg.series,
    topic: cfg.topic,
    hook: cfg.hook,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId: cfg.variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    scenes,
  };
}

const zoom = (assetId: string, crop: Rect, focal: Rect, id: string, text: string, factKey: string, clip: { start: number; end: number }): Zoom => ({
  assetId,
  crop,
  focal,
  clip,
  claim: { id, type: "data_point", text, evidence: [{ assetId, factKey }] },
});

/* ---------- pilot 19: the payout (rec.hs-payout-account.v1) ---------- */
const PAYOUT = "rec.hs-payout-account.v1";
const P19_CAL = { start: 2.0, end: 7.0 } as const;
const P19_PAY = { start: 18.0, end: 25.0 } as const;

export function pilot19StoryPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-19-story-a",
    title: "17 green days and still short of the payout",
    series: "Read the Rule",
    topic: "One losing day roughly the size of the gap left to a payout profit target",
    hook: "17 green days. One -$1,504 loss.",
    variationId: "p19-story-a",
    expectedTopic: "payout_readiness",
    scenes: [
      {
        sceneId: "p19s-s1-hook", narration: "17 green days out of 18.", takeaway: "Almost every day was green.", headline: "17 green days.", caption: "This month, out of 18.", seconds: 2.6,
        zoom: zoom(PAYOUT, { x: 500, y: 1502, w: 346, h: 96 }, { x: 551, y: 1510, w: 129, h: 71 }, "p19s-c1", "Green days: 17 of 18.", "calendar.green_days", P19_CAL),
      },
      {
        sceneId: "p19s-s2-contrast", narration: "Then the one red day: minus $1,504.", takeaway: "The one losing day.", headline: "-$1,504. The one red day.", caption: "The worst day this month.", seconds: 2.8,
        zoom: zoom(PAYOUT, { x: 500, y: 1392, w: 346, h: 96 }, { x: 550, y: 1400, w: 186, h: 72 }, "p19s-c2", "Worst day: -$1,504.04.", "calendar.worst_day", P19_CAL),
      },
      {
        sceneId: "p19s-s3-plain", narration: "The profit target is what you have to reach before a payout.", takeaway: "What the profit target is.", headline: "The target is the line to clear.", caption: "Before a payout.", seconds: 3.4,
        claimText: "A profit target is the amount an account has to reach before a payout is available.",
      },
      {
        sceneId: "p19s-s4-so", narration: "And the account is still $1,484 short of it.", takeaway: "How far from the target.", headline: "$1,484 still to go.", caption: "Short of the target.", seconds: 3.2,
        zoom: zoom(PAYOUT, { x: 372, y: 526, w: 378, h: 50 }, { x: 450, y: 533, w: 281, h: 36 }, "p19s-c4", "The account is $1,484.04 short of its profit target.", "payouts.to_go", P19_PAY),
      },
      {
        sceneId: "p19s-s5-gap", narration: "That gap is almost exactly the size of one red day.", takeaway: "The gap and the red day are about the same size.", headline: "The gap is about one red day.", caption: "Almost exactly.", seconds: 3.4,
        claimText: "The gap to the profit target ($1,484.04) is within $20 of the worst day's loss ($1,504.04).",
      },
      {
        sceneId: "p19s-s6-close", narration: "17 green days, one loss. Check your target against your worst day.", takeaway: "Check the target against the worst day.", headline: "17 green days. One loss.", caption: "Check your target against your worst day.", seconds: 4.6, cta: CTA,
        claimText: "Invites the viewer to try it on their own account.", claimType: "invitation",
      },
    ],
  });
}

/* ---------- pilot 21: ten green days (rec.hs-finalday-account.v1) ---------- */
const FINALDAY = "rec.hs-finalday-account.v1";
const P21_DASH = { start: 2.0, end: 7.0 } as const;
const P21_RULES = { start: 17.3, end: 24.0 } as const;

export function pilot21StoryPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-21-story-a",
    title: "10 green days in a row and still not done",
    series: "Read the Rule",
    topic: "An evaluation that is 98% of the way to its profit target after ten green days",
    hook: "10 green days in a row. Still not done.",
    variationId: "p21-story-a",
    expectedTopic: "payout_readiness",
    scenes: [
      {
        sceneId: "p21s-s1-hook", narration: "10 green days in a row.", takeaway: "Ten green days.", headline: "10 green days in a row.", caption: "10 of 10 days green.", seconds: 2.4,
        zoom: zoom(FINALDAY, { x: 500, y: 1338, w: 346, h: 96 }, { x: 551, y: 1346, w: 129, h: 72 }, "p21s-c1", "Green days: 10 of 10.", "dashboard.green_days", P21_DASH),
      },
      {
        sceneId: "p21s-s2-turn", narration: "But only 98% of the target: $2,940 of $3,000.", takeaway: "Ninety-eight percent of the target.", headline: "98% of the target.", caption: "$2,940 of $3,000.", seconds: 3.8,
        zoom: zoom(FINALDAY, { x: 396, y: 1496, w: 346, h: 52 }, { x: 402, y: 1503, w: 334, h: 36 }, "p21s-c2", "Profit target $3,000.00, currently $2,940.00 (98%).", "rules.target_progress", P21_RULES),
      },
      {
        sceneId: "p21s-s3-plain", narration: "The profit target is the amount you have to reach to pass.", takeaway: "What the profit target is.", headline: "The target is the number to pass.", caption: "It is what you must reach.", seconds: 3.2,
        claimText: "A profit target is the amount an evaluation account has to reach to pass.",
      },
      {
        sceneId: "p21s-s4-question", narration: "So what does the next day look like?", takeaway: "What the next session decides.", headline: "So what does day 11 look like?", caption: "Ten days in. Not done.", seconds: 2.8,
        claimText: "A question for the viewer; it makes no claim about the product.",
      },
      {
        sceneId: "p21s-s5-close", narration: "10 green days, and still not done. Know your target before the next session.", takeaway: "Know the target before the next session.", headline: "10 green days. Not done.", caption: "Know your target before the next session.", seconds: 4.8, cta: CTA,
        claimText: "Invites the viewer to try it on their own account.", claimType: "invitation",
      },
    ],
  });
}

/* ---------- pilot 22: two accounts (rec.hs-multi-account-a/b.v1) ---------- */
const MULTI_A = "rec.hs-multi-account-a.v1";
const MULTI_B = "rec.hs-multi-account-b.v1";
const P22_CLIP = { start: 2.0, end: 8.0 } as const;
const WORST_CROP: Rect = { x: 500, y: 1229, w: 346, h: 96 };
const WORST_FOCAL: Rect = { x: 550, y: 1237, w: 187, h: 72 };

export function pilot22StoryPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-22-story-a",
    title: "One trade, two accounts, the same loss twice",
    series: "Read the Rule",
    topic: "One signal taken on two accounts at the same size loses the same amount twice",
    hook: "One trade. Two accounts. Both lost $1,201.",
    variationId: "p22-story-a",
    expectedTopic: "accounts_overview",
    scenes: [
      {
        sceneId: "p22s-s1-hook", narration: "One trade. Account A: minus $1,201.", takeaway: "Account A's worst day.", headline: "-$1,201. Account A.", caption: "The worst day.", seconds: 2.8,
        zoom: zoom(MULTI_A, WORST_CROP, WORST_FOCAL, "p22s-c1", "Account A worst day: -$1,201.00.", "dashboard.multi_a_worst_day", P22_CLIP),
      },
      {
        sceneId: "p22s-s2-contrast", narration: "Account B: the same minus $1,201.", takeaway: "Account B lost the same amount.", headline: "-$1,201. Account B.", caption: "Same day. Same loss.", seconds: 2.6,
        zoom: zoom(MULTI_B, WORST_CROP, WORST_FOCAL, "p22s-c2", "Account B worst day: -$1,201.00.", "dashboard.multi_b_worst_day", P22_CLIP),
      },
      {
        sceneId: "p22s-s3-plain", narration: "So one signal on two accounts means the loss shows up twice.", takeaway: "The loss repeats across accounts.", headline: "One signal. Two accounts.", caption: "The loss shows up twice.", seconds: 3.6,
        claimText: "When the same trade is taken on two accounts at the same size, the loss appears on both accounts.",
      },
      {
        sceneId: "p22s-s4-journal", narration: "Log both accounts in Fillbook, and the repeat shows up right in your calendar.", takeaway: "The journal shows the repeat.", headline: "It shows in the calendar.", caption: "Log every account in one journal.", seconds: 3.6, leadWithWords: true,
        zoom: zoom(MULTI_A, { x: 610, y: 844, w: 376, h: 148 }, { x: 746, y: 852, w: 108, h: 134 }, "p22s-c4", "Account A's calendar shows September 25 as its red day: -$1.2k, one trade.", "dashboard.multi_a_red_day", P22_CLIP),
      },
      {
        sceneId: "p22s-s5-close", narration: "Minus $1,201, twice. Log every account. Check your size.", takeaway: "Log every account and check the size.", headline: "-$1,201. Twice.", caption: "Log every account. Check your size.", seconds: 4.8, cta: CTA,
        claimText: "Invites the viewer to try it on their own account.", claimType: "invitation",
      },
    ],
  });
}

export const MORE_STORY_PILOTS: ScenePlan[] = [pilot19StoryPlan(), pilot21StoryPlan(), pilot22StoryPlan()];
