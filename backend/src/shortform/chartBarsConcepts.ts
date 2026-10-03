import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type ChartRow, type Claim, type MockSpec, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * Bar-chart concepts (see chart.ts, the "bars" kind): one labelled bar chart per concept, each drawn from a single
 * verified recording of a DIFFERENT part of the product. The first chart cards were all about payouts and the
 * win-rate paradox, so the daily queue kept serving one theme; these cover what else Fillbook reports on:
 *
 *   chart-bars-day-of-week     Reports, by day of the week
 *   chart-bars-time-of-day     Reports, by time of day
 *   chart-bars-habit-cost      Insights, tagged habits and what each cost
 *   chart-bars-conviction      Reports, "would you take it again?"
 *   chart-bars-plan-window     Plan vs reality, inside vs outside the planned session
 *   chart-bars-sized-up        Insights, flagged trades sized up after a loss
 *   chart-bars-edge-map        Edge Score and what it is made of
 *   chart-bars-win-drift       Progress, win rate baseline vs recent
 *   chart-bars-consistency     Account health, one day vs the firm's consistency cap
 *
 * Same rules as every chart card: every number on screen or in a caption is a number on the recording's facts (chart.ts
 * checks it), the scene says "Demo data", and nothing promises an outcome or says what to trade. A bar is a fact the
 * product shows, never advice.
 */
const VISUAL_STYLE = "chart-card-v1";
const VOICE = "none (on-screen text and music only)";
const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;

interface BeatInput {
  stage: number;
  narration: string;
  takeaway: string;
  caption: string;
  seconds: number;
  /** Fact keys this beat's narration and caption draw on. */
  facts: string[];
  closing?: boolean;
}

interface BarsConfig {
  planId: string;
  title: string;
  topic: string;
  variationId: string;
  assetId: string;
  /** The topic of the facts the beats cite (must also be one of the recording's topics). */
  expectedTopic: string;
  lines: string[];
  accent: "good" | "bad";
  rows: ChartRow[];
  highlight: number;
  /** When set, the plan is drawn as an HTML product mock (chart kind "mock") instead of bars; lines may then be 1-3 short lines. */
  mock?: MockSpec;
  beats: BeatInput[];
}

function buildBarsPlan(cfg: BarsConfig): ScenePlan {
  const headline = cfg.lines.join(" ");
  const scenes: SceneSpec[] = cfg.beats.map((b, i) => {
    const claim: Claim = {
      id: `${cfg.variationId}-c${i + 1}`,
      type: "data_point",
      text: b.narration,
      evidence: b.facts.map((factKey) => ({ assetId: cfg.assetId, factKey })),
    };
    return {
      sceneId: `${cfg.variationId}-s${i + 1}`,
      narration: b.narration,
      takeaway: b.takeaway,
      assetId: cfg.assetId,
      focalRegion: null,
      crop: null,
      aspectRatio: "source" as const,
      layout: "chart" as const,
      headline,
      captionText: b.caption,
      durationSeconds: b.seconds,
      transition: i === 0 ? { type: "cut" as const, durationSeconds: 0 } : { type: "fade" as const, durationSeconds: 0.15 },
      disclosure: "Demo data",
      cta: b.closing ? CTA : null,
      platform: "both" as const,
      experimentId: PILOT_EXPERIMENT_ID,
      variationId: cfg.variationId,
      expectedTopics: [cfg.expectedTopic],
      claims: b.closing ? [claim, { id: `${cfg.variationId}-invite`, type: "invitation" as const, text: "Invites the viewer to try it on their own account.", evidence: [] }] : [claim],
      masks: [],
      chart: cfg.mock
        ? { kind: "mock" as const, lines: [...cfg.lines], accent: cfg.accent, mock: cfg.mock, stage: b.stage, ...(b.closing ? { dim: true } : {}) }
        : { kind: "bars" as const, lines: [...cfg.lines], accent: cfg.accent, rows: cfg.rows, highlight: cfg.highlight, stage: b.stage, ...(b.closing ? { dim: true } : {}) },
    };
  });
  return {
    planId: cfg.planId,
    title: cfg.title,
    series: "What Your Journal Shows",
    topic: cfg.topic,
    hook: headline,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId: cfg.variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    voiceover: "none",
    scenes,
  };
}

export function barsDayOfWeekPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-day-of-week",
    title: "Tuesday made $157, Monday lost $57",
    topic: "A sample account's profit by day of the week, and the one weekday that lost money",
    variationId: "bars-dow",
    assetId: "rec.p8-day-of-week.v1",
    expectedTopic: "day_of_week",
    lines: ["Tuesday made $157.", "Monday lost $57."],
    accent: "bad",
    highlight: 0,
    rows: [
      { label: "Monday · 5 trades", display: "-$57.32", amount: 57.32, tone: "bad" },
      { label: "Tuesday · 5 trades", display: "$157.12", amount: 157.12, tone: "good" },
      { label: "Wednesday · 4 trades", display: "$60.60", amount: 60.6, tone: "good" },
      { label: "Thursday · 4 trades", display: "$104.60", amount: 104.6, tone: "good" },
      { label: "Friday · 4 trades", display: "$122.08", amount: 122.08, tone: "good" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["dow.all"], narration: "Fillbook Reports show profit by day of the week.", takeaway: "Reports split profit by weekday.", caption: "Reports: profit by weekday." },
      { stage: 2, seconds: 3.2, facts: ["dow.all"], narration: "Tuesday made $157.12. Friday made $122.08.", takeaway: "The two best days.", caption: "Tuesday: $157.12." },
      { stage: 3, seconds: 3.4, facts: ["dow.all", "dow.monday"], narration: "But Monday is the only red day: -$57.32.", takeaway: "Monday is the only losing day.", caption: "Only Monday is red." },
      { stage: 4, seconds: 3.2, facts: ["dow.all"], closing: true, narration: "Tuesday made $157. Monday lost $57. Fillbook shows yours by weekday.", takeaway: "Look at your own weekdays.", caption: "Check your own weekdays." },
    ],
  });
}

export function barsTimeOfDayPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-time-of-day",
    title: "71% win at the open, 24% later",
    topic: "A sample account's win rate in the opening hour against late morning",
    variationId: "bars-tod",
    assetId: "rec.b3-reports-timing-conviction.v1",
    expectedTopic: "time_of_day",
    lines: ["71% win at the open.", "Only 24% after 10:30."],
    accent: "bad",
    highlight: 1,
    rows: [
      { label: "Open, 9:30-10:30am ET · 106 trades", display: "71% win", amount: 71, tone: "good" },
      { label: "Late morning, 10:30am-12pm ET · 25 trades", display: "24% win", amount: 24, tone: "bad" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["timing.buckets"], narration: "Fillbook Reports break win rate down by time of day.", takeaway: "Reports split win rate by time window.", caption: "Reports: win rate by time." },
      { stage: 2, seconds: 3.2, facts: ["timing.buckets"], narration: "The open: 106 trades, 71% win, $2,967.96.", takeaway: "The opening hour.", caption: "Open: 71% win." },
      { stage: 3, seconds: 3.4, facts: ["timing.buckets"], narration: "But late morning: 25 trades, 24% win, -$1,406.00.", takeaway: "Late morning is far weaker.", caption: "Late morning: 24% win." },
      { stage: 4, seconds: 3.2, facts: ["timing.buckets"], closing: true, narration: "71% win at the open. Only 24% after 10:30. Fillbook shows your own hours.", takeaway: "Find your own strong hour.", caption: "Find your strong hour." },
    ],
  });
}

export function barsHabitCostPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-habit-cost",
    title: "Moved stops cost $656, discipline made $828",
    topic: "A sample account's tagged habits, and what the trades under each tag added up to",
    variationId: "bars-habit",
    assetId: "rec.b3-insights-behavior.v1",
    expectedTopic: "mistake_tags",
    lines: ["Moved stops cost $656.", "Discipline made $828."],
    accent: "good",
    highlight: 0,
    rows: [
      { label: "Moved stop · 4 trades", display: "-$655.84", amount: 655.84, tone: "bad" },
      { label: "Chased price · 10 trades", display: "-$629.60", amount: 629.6, tone: "bad" },
      { label: "Good discipline · 12 trades", display: "$828.48", amount: 828.48, tone: "good" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["tags.all"], narration: "Tag each trade, and Fillbook Insights adds up every tag.", takeaway: "Insights total each tag.", caption: "Insights: net result by tag." },
      { stage: 2, seconds: 3.2, facts: ["tags.all"], narration: "4 trades tagged Moved stop lost $655.84.", takeaway: "What Moved stop cost.", caption: "Moved stop: -$655.84." },
      { stage: 3, seconds: 3.4, facts: ["tags.all"], narration: "But 12 trades tagged Good discipline made $828.48.", takeaway: "What discipline made.", caption: "Discipline: $828.48." },
      { stage: 4, seconds: 3.2, facts: ["tags.all"], closing: true, narration: "Moved stops cost $656. Discipline made $828. Fillbook adds up your own tags.", takeaway: "Tag your own trades and see.", caption: "Add up your own tags." },
    ],
  });
}

export function barsConvictionPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-conviction",
    title: "Trades you'd retake made $3,822, the rest lost $2,576",
    topic: "A sample account's results split by whether the trader would take the trade again",
    variationId: "bars-conv",
    assetId: "rec.b3-reports-timing-conviction.v1",
    expectedTopic: "conviction",
    lines: ["Would retake: $3,822.", "Wouldn't: lost $2,576."],
    accent: "bad",
    highlight: 1,
    rows: [
      { label: "Would take again · 75 trades", display: "$3,822.00", amount: 3822, tone: "good" },
      { label: "Wouldn't take again · 34 trades", display: "-$2,575.96", amount: 2575.96, tone: "bad" },
      { label: "Unsure · 22 trades", display: "$315.92", amount: 315.92, tone: "good" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["conviction.all"], narration: "In Fillbook, answer one question per trade: would you take it again?", takeaway: "Answer once per trade; Reports compare.", caption: "Reports: by conviction." },
      { stage: 2, seconds: 3.2, facts: ["conviction.all"], narration: "75 trades you would take again made $3,822.00.", takeaway: "The trades you'd retake.", caption: "Would retake: $3,822." },
      { stage: 3, seconds: 3.4, facts: ["conviction.all"], narration: "But 34 you wouldn't take again lost $2,575.96.", takeaway: "The trades you wouldn't.", caption: "Wouldn't: -$2,575.96." },
      { stage: 4, seconds: 3.2, facts: ["conviction.all"], closing: true, narration: "Would retake: $3,822. Wouldn't: lost $2,576. Fillbook splits your own trades the same way.", takeaway: "Rate your own trades.", caption: "Rate your own trades." },
    ],
  });
}

export function barsPlanWindowPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-plan-window",
    title: "Inside the plan $21 a trade, outside it -$39",
    topic: "A sample account's average result per trade inside and outside its planned trading window",
    variationId: "bars-plan",
    assetId: "rec.b3-plan-vs-reality.v1",
    expectedTopic: "plan_adherence",
    lines: ["In the plan: $21.", "Outside it: lost $39."],
    accent: "bad",
    highlight: 1,
    rows: [
      { label: "Inside 09:30-11:30 · average per trade", display: "$21.13", amount: 21.13, tone: "good" },
      { label: "Outside it · 20 trades, average per trade", display: "-$39.16", amount: 39.16, tone: "bad" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["plan.focus"], narration: "Set your trading window in your Fillbook plan, then compare it with what happened.", takeaway: "Fillbook compares the plan with what happened.", caption: "Plan vs what happened." },
      { stage: 2, seconds: 3.2, facts: ["plan.focus"], narration: "Inside 09:30-11:30, trades average $21.13.", takeaway: "Results inside the window.", caption: "Inside the window: $21.13." },
      { stage: 3, seconds: 3.4, facts: ["plan.focus"], narration: "But 20 trades outside it average -$39.16 each.", takeaway: "Results outside the window.", caption: "Outside it: -$39.16." },
      { stage: 4, seconds: 3.2, facts: ["plan.focus"], closing: true, narration: "In the plan: $21. Outside it: lost $39. Fillbook compares your own plan the same way.", takeaway: "Check your own plan.", caption: "Check your own plan." },
    ],
  });
}

export function barsSizedUpPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-sized-up",
    title: "Lost $127, then sized up 2.5x",
    topic: "Five flagged trades a sample account opened soon after a loss, each larger than its average size",
    variationId: "bars-sized",
    assetId: "rec.b3-insights-behavior.v1",
    expectedTopic: "revenge_trading",
    lines: ["Lost $127.", "Then sized", "up 2.5x."],
    accent: "bad",
    highlight: 0,
    mock: {
      eyebrow: "SAMPLE ACCOUNT",
      accentFrom: 1,
      source: {
        title: "Trade history",
        columns: ["WHEN", "SYMBOL", "RESULT"],
        rows: [
          { when: "Loss", symbol: "MNQ", value: "-$127", tone: "bad" },
          { when: "3 min later", symbol: "MNQ", value: "2.5x size", tone: "bad" },
        ],
      },
      step: "FILLBOOK INSIGHTS",
      result: {
        title: "Behavior patterns",
        tag: "Demo data",
        stats: [
          { label: "POSSIBLE REVENGE TRADES", value: "5" },
          { label: "SIZE VS YOUR AVERAGE", value: "2.5x", meter: { markAt: 0.4 } },
        ],
      },
    },
    rows: [
      { label: "3 min after losing $127", display: "2.5x size", amount: 2.5, tone: "bad" },
      { label: "4 min after losing $107", display: "2.4x size", amount: 2.4, tone: "bad" },
      { label: "12 min after losing $63", display: "2.0x size", amount: 2, tone: "bad" },
      { label: "7 min after losing $75", display: "1.9x size", amount: 1.9, tone: "bad" },
      { label: "9 min after losing $87", display: "1.5x size", amount: 1.5, tone: "bad" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["behavior.revenge"], narration: "Fillbook Insights flagged 5 possible revenge trades.", takeaway: "Insights flag five trades for review.", caption: "5 possible revenge trades." },
      { stage: 2, seconds: 3.2, facts: ["behavior.revenge"], narration: "Each opened minutes after a loss, bigger than your average size.", takeaway: "Each came soon after a loss, at a larger size.", caption: "Flagged: bigger after a loss." },
      { stage: 3, seconds: 3.4, facts: ["behavior.revenge"], narration: "But the largest was 2.5x your average, 3 minutes after losing $127.", takeaway: "The largest flagged trade.", caption: "Flagged: 2.5x size." },
      { stage: 4, seconds: 3.2, facts: ["behavior.revenge"], closing: true, narration: "Lost $127. Then sized up 2.5x. Fillbook flags trades like these for your review.", takeaway: "Review your own flagged trades.", caption: "Review your flagged trades." },
    ],
  });
}

export function barsEdgeMapPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-edge-map",
    title: "An Edge Score of 67, and what it's made of",
    topic: "A sample account's Edge Score and the four parts it blends",
    variationId: "bars-edge",
    assetId: "rec.p6-edge-score.v1",
    expectedTopic: "edge_score",
    lines: ["Edge Score: 67.", "Still developing."],
    accent: "good",
    highlight: 0,
    rows: [
      { label: "Profitability", display: "59", amount: 59, tone: "bad" },
      { label: "Consistency", display: "63", amount: 63, tone: "good" },
      { label: "Risk control", display: "69", amount: 69, tone: "good" },
      { label: "Rule adherence", display: "87", amount: 87, tone: "good" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["edge.score", "edge.map"], narration: "Fillbook gives one score for how you trade: Edge Score 67.", takeaway: "One score, built from several parts.", caption: "Edge Score: 67." },
      { stage: 2, seconds: 3.2, facts: ["edge.score", "edge.map"], narration: "Rule adherence is 87. Risk control is 69.", takeaway: "The strongest parts.", caption: "Rule adherence: 87." },
      { stage: 3, seconds: 3.4, facts: ["edge.score", "edge.map"], narration: "But profitability is only 59, the lowest part.", takeaway: "The weakest part.", caption: "Profitability: only 59." },
      { stage: 4, seconds: 3.2, facts: ["edge.score", "edge.map"], closing: true, narration: "Edge Score 67. Profitability 59. Fillbook shows what yours is made of.", takeaway: "See your own score.", caption: "See your own score." },
    ],
  });
}

export function barsWinDriftPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-win-drift",
    title: "Win rate 76%, then 55%",
    topic: "A sample account's win rate against its own baseline, and how far recent trades have drifted",
    variationId: "bars-drift",
    assetId: "rec.b3-progress.v1",
    expectedTopic: "progress",
    lines: ["Win rate: 76%.", "Lately: only 55%."],
    accent: "bad",
    highlight: 1,
    rows: [
      { label: "Baseline win rate", display: "76%", amount: 76, tone: "good" },
      { label: "Recent win rate", display: "55%", amount: 55, tone: "bad" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["progress.win_rate"], narration: "Fillbook's Progress page compares your win rate now with your own baseline.", takeaway: "Progress compares recent with baseline.", caption: "Progress: recent vs baseline." },
      { stage: 2, seconds: 3.2, facts: ["progress.win_rate"], narration: "The baseline is 76%.", takeaway: "The baseline.", caption: "Baseline: 76%." },
      { stage: 3, seconds: 3.4, facts: ["progress.win_rate"], narration: "But recent trades win 55%, down 21%.", takeaway: "Recent trades have slipped.", caption: "Recent: 55%, down 21%." },
      { stage: 4, seconds: 3.2, facts: ["progress.win_rate"], closing: true, narration: "Win rate 76%. Lately only 55%. Fillbook tracks yours against your own baseline.", takeaway: "Check your own drift.", caption: "Check your own drift." },
    ],
  });
}

export function barsConsistencyPlan(): ScenePlan {
  return buildBarsPlan({
    planId: "chart-bars-consistency",
    title: "One day made 46% of the profit; the cap is 40%",
    topic: "A sample account where one day accounts for more of the total profit than the firm's consistency cap",
    variationId: "bars-cons",
    assetId: "rec.p4-account-health-consistency.v1",
    expectedTopic: "consistency",
    lines: ["One day made 46%.", "The cap: only 40%."],
    accent: "bad",
    highlight: 0,
    rows: [
      { label: "One day's share of total profit", display: "46%", amount: 46, tone: "bad" },
      { label: "The firm's consistency cap", display: "40%", amount: 40, tone: "good" },
    ],
    beats: [
      { stage: 1, seconds: 3.0, facts: ["health.consistency_action"], narration: "Fillbook's Account health shows one day made 46% of your total profit.", takeaway: "Account health shows one day's share of profit.", caption: "One day: 46% of profit." },
      { stage: 2, seconds: 3.2, facts: ["health.consistency_action"], narration: "A consistency cap limits any one day to 40% of your total profit.", takeaway: "What the cap limits.", caption: "The cap: 40% of profit." },
      { stage: 3, seconds: 3.4, facts: ["health.consistency_action"], narration: "But 46% is over the firm's cap.", takeaway: "That day is over the cap.", caption: "46% is over the cap." },
      { stage: 4, seconds: 3.2, facts: ["health.consistency_action"], closing: true, narration: "One day made 46%. The cap is 40%. Fillbook shows your own biggest day's share.", takeaway: "Check your biggest day.", caption: "Check your biggest day." },
    ],
  });
}

export const BARS_PILOTS: ScenePlan[] = [
  barsDayOfWeekPlan(),
  barsTimeOfDayPlan(),
  barsHabitCostPlan(),
  barsConvictionPlan(),
  barsPlanWindowPlan(),
  barsSizedUpPlan(),
  barsEdgeMapPlan(),
  barsWinDriftPlan(),
  barsConsistencyPlan(),
];
