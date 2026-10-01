import { OFFICIAL_HANDLE, type ScenePlan } from "./types.js";
import { buildStoryPlan, zoom } from "./storyPilotsMore.js";

/**
 * Story rebuilds of the pilot with proven pull. The original "Read this before your first trade" (the Daily Brief,
 * rec.p7-daily-brief.v1) is the one video that broke out on TikTok (9,009 views against a typical 100-300). The three
 * payoff variants made later (payoffPilots.ts) grade D on the story scorecard, so the render bar refuses them. These
 * three keep the same recording and the same four verified lines, and each tells ONE idea from them:
 *
 *   pilot-7-story-a  "$1,725 of room. Only $1,000 today."  two limits; the smaller one is today's
 *   pilot-7-story-b  "22 trades. 64% wins. But when?"     your strongest window is a time of day
 *   pilot-7-story-c  "A -$17 day. $1,725 still left."     what a small loss leaves, and what a bigger one would use
 *
 * Nothing here claims more than the recording shows: it never says what happens when a limit is reached, never says the
 * other hours are worse, and never calls the numbers anyone's own (they are a demo account's).
 */
const REC = "rec.p7-daily-brief.v1";
const CLIP = { start: 2.0, end: 9.0 } as const;
const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;

// Crops and focal regions are measured on the recording's own pixels (1080x1920); each holds one complete line.
const BUFFER = { crop: { x: 56, y: 500, w: 428, h: 112 }, focal: { x: 70, y: 505, w: 405, h: 100 } };
const LOSS_LIMIT = { crop: { x: 492, y: 545, w: 384, h: 68 }, focal: { x: 494, y: 552, w: 370, h: 52 } };
const LAST_SESSION = { crop: { x: 56, y: 328, w: 330, h: 112 }, focal: { x: 70, y: 330, w: 290, h: 108 } };
const WINDOW_LINE = { crop: { x: 70, y: 640, w: 740, h: 100 }, focal: { x: 458, y: 680, w: 335, h: 48 } };
const WINDOW_NAME = { crop: { x: 70, y: 682, w: 380, h: 56 }, focal: { x: 80, y: 688, w: 362, h: 44 } };

export function pilot7StoryAPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-7-story-a",
    title: "$1,725 of room, but only $1,000 today",
    series: "What Your Journal Shows",
    topic: "The daily brief shows two limits before the first trade; the smaller one is the one that applies today",
    hook: "$1,725 of room. Only $1,000 today.",
    variationId: "p7s-a",
    expectedTopic: "daily_brief",
    scenes: [
      {
        sceneId: "p7s-a-s1-room", narration: "You have $1,725 of room to lose.", takeaway: "How much room the account has.", headline: "$1,725 of room", caption: "Before the account's limit.", seconds: 2.8,
        zoom: zoom(REC, BUFFER.crop, BUFFER.focal, "p7s-a-c1", "$1,725 of buffer to the floor.", "brief.buffer", CLIP),
      },
      {
        sceneId: "p7s-a-s2-today", narration: "But today, you can only lose $1,000.", takeaway: "Today's loss limit is smaller.", headline: "$1,000 today", caption: "Today's loss limit.", seconds: 3.0,
        zoom: zoom(REC, LOSS_LIMIT.crop, LOSS_LIMIT.focal, "p7s-a-c2", "$1,000 of today's loss limit.", "brief.loss_limit", CLIP),
      },
      { sceneId: "p7s-a-s3-smaller", narration: "So the smaller number is the one to watch.", takeaway: "Watch the smaller limit.", headline: "The smaller number is your limit.", caption: "Know which one you're closer to.", seconds: 3.0 },
      { sceneId: "p7s-a-s4-brief", narration: "Your daily brief shows both, before your first trade.", takeaway: "The brief shows both limits.", headline: "Your brief shows both.", caption: "Before trade one.", seconds: 3.0 },
      { sceneId: "p7s-a-s5-close", narration: "$1,725 of room. Only $1,000 today. Read this before your first trade.", takeaway: "Check the limits first.", headline: "Read this before your first trade.", caption: "Check your own numbers first.", seconds: 4.4, cta: CTA, claimType: "invitation", claimText: "Invites the viewer to try it on their own account." },
    ],
  });
}

export function pilot7StoryBPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-7-story-b",
    title: "A 64% win rate, in one window",
    series: "What Your Journal Shows",
    topic: "The daily brief shows the account's strongest window: a time of day, with its record",
    hook: "22 trades. 64% wins. But when?",
    variationId: "p7s-b",
    expectedTopic: "daily_brief",
    scenes: [
      {
        sceneId: "p7s-b-s1-record", narration: "A 64% win rate over 22 trades. But when?", takeaway: "The record of the strongest window.", headline: "64% win rate over 22 trades", caption: "This account's strongest window.", seconds: 3.2,
        zoom: zoom(REC, WINDOW_LINE.crop, WINDOW_LINE.focal, "p7s-b-c1", "Strongest window: 22 trades at a 64% win rate.", "brief.window_stats", CLIP),
      },
      {
        sceneId: "p7s-b-s2-open", narration: "The open: the first hour of the day.", takeaway: "The window is a time of day.", headline: "The first hour.", caption: "Open, 9:30 to 10:30 ET.", seconds: 3.0, leadWithWords: true,
        zoom: zoom(REC, WINDOW_NAME.crop, WINDOW_NAME.focal, "p7s-b-c2", "The strongest window is the Open, 9:30 to 10:30am ET.", "brief.window_name", CLIP),
      },
      { sceneId: "p7s-b-s3-check", narration: "So check your own record before you trade.", takeaway: "Look at your own record.", headline: "Check yours before you trade.", caption: "Your hours may differ.", seconds: 3.0 },
      { sceneId: "p7s-b-s4-close", narration: "A 64% win rate, in one window. Read this before your first trade.", takeaway: "Check your own window first.", headline: "Read this before your first trade.", caption: "Check your own numbers first.", seconds: 4.4, cta: CTA, claimType: "invitation", claimText: "Invites the viewer to try it on their own account." },
    ],
  });
}

export function pilot7StoryCPlan(): ScenePlan {
  return buildStoryPlan({
    planId: "pilot-7-story-c",
    title: "A -$17 day and $1,725 still left",
    series: "What Your Journal Shows",
    topic: "The daily brief shows last session's result next to the room the account has left",
    hook: "A -$17 day. $1,725 still left.",
    variationId: "p7s-c",
    expectedTopic: "daily_brief",
    scenes: [
      {
        sceneId: "p7s-c-s1-loss", narration: "Last session: one trade, minus $17.", takeaway: "Yesterday's result.", headline: "-$17 last session", caption: "One trade.", seconds: 2.6,
        zoom: zoom(REC, LAST_SESSION.crop, LAST_SESSION.focal, "p7s-c-c1", "Last session: -$17 on 1 trade.", "brief.last_session_value", CLIP),
      },
      {
        sceneId: "p7s-c-s2-left", narration: "The account still has $1,725 of room to lose.", takeaway: "What is left.", headline: "$1,725 still left", caption: "Room to lose.", seconds: 3.0,
        zoom: zoom(REC, BUFFER.crop, BUFFER.focal, "p7s-c-c2", "$1,725 of buffer to the floor.", "brief.buffer", CLIP),
      },
      { sceneId: "p7s-c-s3-bigger", narration: "But a bigger loss would use that up faster.", takeaway: "A bigger loss uses the room faster.", headline: "A bigger loss uses it faster.", caption: "Know what one trade costs.", seconds: 3.0 },
      { sceneId: "p7s-c-s4-check", narration: "So check your room before trade one.", takeaway: "Check the room first.", headline: "Check your room first.", caption: "Before the first trade.", seconds: 2.6 },
      { sceneId: "p7s-c-s5-close", narration: "A minus $17 day, and $1,725 still left. Read this before your first trade.", takeaway: "Check the room first.", headline: "Read this before your first trade.", caption: "Check your own numbers first.", seconds: 4.6, cta: CTA, claimType: "invitation", claimText: "Invites the viewer to try it on their own account." },
    ],
  });
}

export const PILOT7_STORY_PILOTS: ScenePlan[] = [pilot7StoryAPlan(), pilot7StoryBPlan(), pilot7StoryCPlan()];
