import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type ChartSpec, type Claim, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * Chart-card concepts (see types.ts, "chart" layout): a one-line paradox over one self-explaining chart, no screenshot,
 * music only. Modelled on what works for the nearest small account in the category (@tradingdataset: median ~960
 * views against our ~150 for dashboard crops): the picture is the proof, so a stranger needs no context to get it.
 *
 *   chart-a-17-green-days     "17 green days. Still $1,484 short."      18 day-squares, a payout bar, one red day the size of the gap
 *   chart-b-10-green-days     "10 green days. Still not done."          10 day-squares and a bar at 98% of the target
 *   chart-c-one-signal-two    "One signal. Two accounts. Both lost $1,201." two equal red bars from one marker
 *
 * Every number drawn comes from a fact on a verified recording (the scene cites it, and chart.ts checks the chart
 * against it); the gap a bar shows is target - value. Nothing here says what happens at a limit or why a loss happened.
 */
const VISUAL_STYLE = "chart-card-v1";
const VOICE = "none (on-screen text and music only)";
const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;

interface BeatInput {
  /** Which chart beat this scene reveals (see ChartSpec.stage). */
  stage: number;
  narration: string;
  takeaway: string;
  caption: string;
  seconds: number;
  assetId: string;
  claims: Claim[];
  closing?: boolean;
}

interface ChartPlanConfig {
  planId: string;
  title: string;
  topic: string;
  variationId: string;
  expectedTopic: string;
  headline: string;
  chart: Omit<ChartSpec, "stage" | "dim">;
  beats: BeatInput[];
}

const data = (id: string, text: string, assetId: string, factKeys: string[]): Claim => ({ id, type: "data_point", text, evidence: factKeys.map((factKey) => ({ assetId, factKey })) });

function buildChartPlan(cfg: ChartPlanConfig): ScenePlan {
  const scenes: SceneSpec[] = cfg.beats.map((b, i) => ({
    sceneId: `${cfg.variationId}-s${i + 1}`,
    narration: b.narration,
    takeaway: b.takeaway,
    assetId: b.assetId,
    focalRegion: null,
    crop: null,
    aspectRatio: "source" as const,
    layout: "chart" as const,
    headline: cfg.headline,
    captionText: b.caption,
    durationSeconds: b.seconds,
    transition: i === 0 ? { type: "cut" as const, durationSeconds: 0 } : { type: "fade" as const, durationSeconds: 0.15 },
    disclosure: "Demo data",
    cta: b.closing ? CTA : null,
    platform: "both" as const,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId: cfg.variationId,
    expectedTopics: [cfg.expectedTopic],
    claims: b.closing ? [...b.claims, { id: `${cfg.variationId}-invite`, type: "invitation" as const, text: "Invites the viewer to try it on their own account.", evidence: [] }] : b.claims,
    masks: [],
    chart: { ...cfg.chart, stage: b.stage, ...(b.closing ? { dim: true } : {}) },
  }));
  return {
    planId: cfg.planId,
    title: cfg.title,
    series: "What Your Journal Shows",
    topic: cfg.topic,
    hook: cfg.headline,
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

/* ---------- A: 17 green days, still short of the payout (rec.hs-payout-account.v1) ---------- */
const PAYOUT = "rec.hs-payout-account.v1";
export function chartAPlan(): ScenePlan {
  const green = data("ca-c1", "17 of 18 days are green.", PAYOUT, ["calendar.green_days"]);
  const gap = data("ca-c2", "$7,515.96 of the $9,000 payout target: $1,484.04 to go.", PAYOUT, ["payouts.to_go"]);
  const red = data("ca-c3", "The worst day is -$1,504.04, about the size of the $1,484.04 gap.", PAYOUT, ["calendar.worst_day", "payouts.to_go"]);
  return buildChartPlan({
    planId: "chart-a-17-green-days",
    title: "17 green days and $1,484 still to go",
    topic: "A month of 17 green days out of 18, and the payout gap that one red day is about the size of",
    variationId: "chart-a",
    expectedTopic: "payout_readiness",
    headline: "17 green days. Still $1,484 short.",
    chart: {
      kind: "grid_progress",
      lines: ["17 green days.", "Still $1,484 short."],
      accent: "good",
      grid: { total: 18, good: 17, badAt: [13], cols: 6 },
      progress: { label: "Payout target: $9,000", value: 7515.96, target: 9000, gapLabel: "$1,484 to go" },
    },
    beats: [
      { stage: 1, narration: "17 of 18 days were green.", takeaway: "Almost every day was green.", caption: "17 of 18 days green.", seconds: 3.0, assetId: PAYOUT, claims: [green, gap] },
      { stage: 2, narration: "The payout target is $9,000, and the account is $1,484 short.", takeaway: "How far from the target.", caption: "$7,516 of the $9,000 target.", seconds: 3.2, assetId: PAYOUT, claims: [green, gap] },
      { stage: 3, narration: "But one red day, -$1,504, is about the size of the gap.", takeaway: "One red day is the size of the gap.", caption: "One red day: -$1,504. About the size of the gap.", seconds: 3.4, assetId: PAYOUT, claims: [green, gap, red] },
      { stage: 4, narration: "17 green days. $1,484 short. Check your target against your worst day.", takeaway: "Check the target against the worst day.", caption: "Check your worst day.", seconds: 3.2, assetId: PAYOUT, claims: [green, gap], closing: true },
    ],
  });
}

/* ---------- B: 10 green days in a row, still not done (rec.hs-finalday-account.v1) ---------- */
const FINALDAY = "rec.hs-finalday-account.v1";
export function chartBPlan(): ScenePlan {
  const green = data("cb-c1", "10 of 10 days are green.", FINALDAY, ["dashboard.green_days"]);
  const target = data("cb-c2", "Profit target $3,000.00, currently $2,940.00 (98%).", FINALDAY, ["rules.target_progress"]);
  return buildChartPlan({
    planId: "chart-b-10-green-days",
    title: "10 green days and still not done",
    topic: "Ten green days out of ten, and an account still short of its profit target",
    variationId: "chart-b",
    expectedTopic: "payout_readiness",
    headline: "10 green days. Still not done.",
    chart: {
      kind: "grid_progress",
      lines: ["10 green days.", "Still not done."],
      accent: "good",
      grid: { total: 10, good: 10, badAt: [], cols: 5 },
      progress: { label: "Profit target: $3,000", value: 2940, target: 3000, gapLabel: "$60 to go" },
    },
    beats: [
      { stage: 1, narration: "10 of 10 days were green.", takeaway: "Every day was green.", caption: "10 of 10 days green.", seconds: 2.8, assetId: FINALDAY, claims: [green, target] },
      { stage: 2, narration: "The profit target is $3,000, and the account is at $2,940.", takeaway: "How close to the target.", caption: "$2,940 of the $3,000 target.", seconds: 3.2, assetId: FINALDAY, claims: [green, target] },
      { stage: 3, narration: "But 10 for 10 is still not at the target.", takeaway: "Ten for ten is still short.", caption: "10 for 10. Still short.", seconds: 3.0, assetId: FINALDAY, claims: [green, target] },
      { stage: 4, narration: "10 green days. Still not done. Know your target before the next session.", takeaway: "Know the target before the next session.", caption: "Know your target.", seconds: 3.2, assetId: FINALDAY, claims: [green, target], closing: true },
    ],
  });
}

/* ---------- C: one signal, two accounts, the same loss twice (rec.hs-multi-account-a.v1 / -b.v1) ---------- */
const MULTI_A = "rec.hs-multi-account-a.v1";
const MULTI_B = "rec.hs-multi-account-b.v1";
export function chartCPlan(): ScenePlan {
  const a = data("cc-c1", "Account A's worst day is -$1,201.00.", MULTI_A, ["dashboard.multi_a_worst_day"]);
  const b = data("cc-c2", "Account B's worst day is -$1,201.00.", MULTI_B, ["dashboard.multi_b_worst_day"]);
  const b2 = data("cc-c3", "Account B lost the same -$1,201.00 as Account A.", MULTI_B, ["dashboard.multi_b_worst_day"]);
  return buildChartPlan({
    planId: "chart-c-one-signal-two-accounts",
    title: "One signal, two accounts, both lost $1,201",
    topic: "One trading signal taken on two accounts, and the same worst day on both",
    variationId: "chart-c",
    expectedTopic: "accounts_overview",
    headline: "One signal. Two accounts. Both lost $1,201.",
    chart: {
      kind: "pair",
      lines: ["One signal.", "Two accounts.", "Both lost $1,201."],
      accent: "bad",
      pair: { aLabel: "Account A", bLabel: "Account B", value: "-$1,201" },
    },
    beats: [
      { stage: 1, narration: "One signal. Account A lost $1,201.", takeaway: "Account A's loss.", caption: "Account A: -$1,201.", seconds: 3.0, assetId: MULTI_A, claims: [a] },
      { stage: 2, narration: "But Account B lost the same $1,201.", takeaway: "Account B's loss is the same.", caption: "Account B: -$1,201.", seconds: 3.0, assetId: MULTI_B, claims: [b] },
      { stage: 3, narration: "Same signal. Same loss. Twice.", takeaway: "The same loss on both accounts.", caption: "Same loss. Two accounts.", seconds: 3.0, assetId: MULTI_B, claims: [b2] },
      { stage: 4, narration: "-$1,201, twice. Check your size on every account.", takeaway: "Check the size on every account.", caption: "Check every account.", seconds: 3.2, assetId: MULTI_B, claims: [b], closing: true },
    ],
  });
}

export const CHART_PILOTS: ScenePlan[] = [chartAPlan(), chartBPlan(), chartCPlan()];
