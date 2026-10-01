import { ILLUSTRATIVE_LABEL, illustrationFigures } from "./chart.js";
import { PILOT_EXPERIMENT_ID } from "./pilots.js";
import { OFFICIAL_HANDLE, type ChartIllustration, type Claim, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * Illustrative chart-card concepts: the "win rate isn't profit" paradox, generated from four numbers. Where the
 * hand-made chart cards (chartPilots.ts) draw numbers from a recording of the demo account, these draw them from plain
 * arithmetic and say so on every scene ("Illustrative example"): `trades` trades, `wins` winners averaging `avgWin`
 * dollars, the rest losers averaging `avgLoss`. chart.ts recomputes every figure the card shows (the bars, the net, the
 * win rate, the counts) from those four numbers and refuses a card whose picture or words say anything else, so a card
 * cannot be wrong, and cannot be mistaken for a real account.
 *
 * Each parameter set is one concept; the table below is the supply the daily request job draws from, one at a time.
 */
export type OutcomesParams = ChartIllustration;

const VISUAL_STYLE = "chart-card-v1";
const VOICE = "none (on-screen text and music only)";
const CTA = `Try it free on your own account for 14 days. ${OFFICIAL_HANDLE}`;

const money = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/** Loss positions spread evenly through the trades, so the picture never implies the losses came in a run. */
export function spreadLosses(trades: number, losses: number): number[] {
  return Array.from({ length: losses }, (_, k) => Math.floor(((k + 0.5) * trades) / losses));
}

export function outcomesPlan(p: OutcomesParams): ScenePlan {
  const f = illustrationFigures(p);
  const wr = Math.round(f.winRate);
  const loss = f.net < 0;
  const net = money(f.netAbs);
  const netDisplay = `${loss ? "-" : "+"}${net}`;
  const lines = [`${wr}% win rate.`, loss ? `Still lost ${net}.` : `Still made ${net}.`];
  const headline = lines.join(" ");
  const id = `chart-o-${p.trades}-${p.wins}-${p.avgWin}-${p.avgLoss}`;
  const variationId = id;
  const arithmetic: Claim = {
    id: `${id}-math`,
    type: "concept",
    text: `Illustrative arithmetic: ${p.wins} wins averaging ${money(p.avgWin)} and ${f.losses} losses averaging ${money(p.avgLoss)}.`,
    evidence: [],
  };
  const chartBase = {
    kind: "outcomes" as const,
    lines,
    accent: loss ? ("bad" as const) : ("good" as const),
    grid: { total: p.trades, good: p.wins, badAt: spreadLosses(p.trades, f.losses), cols: 10 },
    bars: [
      { label: `${p.wins} wins`, display: `+${money(f.totalWins)}`, amount: f.totalWins, tone: "good" as const },
      { label: `${f.losses} losses`, display: `-${money(f.totalLosses)}`, amount: f.totalLosses, tone: "bad" as const },
    ] as [{ label: string; display: string; amount: number; tone: "good" }, { label: string; display: string; amount: number; tone: "bad" }],
    net: { display: netDisplay, tone: loss ? ("bad" as const) : ("good" as const) },
    illustration: p,
  };

  const beats = [
    {
      stage: 1, seconds: 3.0,
      narration: `${p.trades} trades. ${p.wins} wins, ${f.losses} losses.`,
      takeaway: "How many trades won and lost.",
      caption: `${p.trades} trades: ${p.wins} wins, ${f.losses} losses.`,
    },
    {
      stage: 2, seconds: 3.2,
      narration: `The ${p.wins} wins made ${money(f.totalWins)}. The ${f.losses} losses cost ${money(f.totalLosses)}.`,
      takeaway: "What the wins made and the losses cost.",
      caption: `Wins +${money(f.totalWins)}. Losses -${money(f.totalLosses)}.`,
    },
    {
      stage: 3, seconds: 3.4,
      narration: loss ? `But the net was a loss of ${net}.` : `But the net was a profit of ${net}.`,
      takeaway: "The net result.",
      caption: "Win rate isn't profit.",
    },
    {
      stage: 4, seconds: 3.2, closing: true,
      narration: `${wr}% win rate. Net ${loss ? "loss" : "profit"} of ${net}. Check your average ${loss ? "loss" : "win"}.`,
      takeaway: "Check the average size, not just the win rate.",
      caption: `Check your average ${loss ? "loss" : "win"}.`,
    },
  ];

  const scenes: SceneSpec[] = beats.map((b, i) => ({
    sceneId: `${id}-s${i + 1}`,
    narration: b.narration,
    takeaway: b.takeaway,
    assetId: null,
    focalRegion: null,
    crop: null,
    aspectRatio: "source" as const,
    layout: "chart" as const,
    headline,
    captionText: b.caption,
    durationSeconds: b.seconds,
    transition: i === 0 ? { type: "cut" as const, durationSeconds: 0 } : { type: "fade" as const, durationSeconds: 0.15 },
    disclosure: ILLUSTRATIVE_LABEL,
    cta: b.closing ? CTA : null,
    platform: "both" as const,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    expectedTopics: ["trading_math"],
    claims: b.closing ? [arithmetic, { id: `${id}-invite`, type: "invitation" as const, text: "Invites the viewer to try it on their own account.", evidence: [] }] : [arithmetic],
    masks: [],
    chart: { ...chartBase, stage: b.stage, ...(b.closing ? { dim: true } : {}) },
  }));

  return {
    planId: id,
    title: `A ${wr}% win rate and ${loss ? "down" : "up"} ${net}`,
    series: "What Your Journal Shows",
    topic: `An illustrative example: a ${wr}% win rate over ${p.trades} trades that nets ${loss ? "a loss" : "a profit"}, because of the size of the wins and losses`,
    hook: headline,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    voiceover: "none",
    scenes,
  };
}

/**
 * The supply of illustrative concepts, in the order the daily request job takes them. Mixed on purpose: a high win
 * rate that loses and a low one that wins, so the feed does not read as one point made twelve times.
 */
export const OUTCOMES_PARAMS: OutcomesParams[] = [
  { trades: 10, wins: 7, avgWin: 100, avgLoss: 900 },
  { trades: 10, wins: 4, avgWin: 500, avgLoss: 150 },
  { trades: 20, wins: 14, avgWin: 100, avgLoss: 500 },
  { trades: 10, wins: 5, avgWin: 300, avgLoss: 100 },
  { trades: 10, wins: 9, avgWin: 50, avgLoss: 600 },
  { trades: 20, wins: 8, avgWin: 400, avgLoss: 100 },
  { trades: 10, wins: 6, avgWin: 150, avgLoss: 600 },
  { trades: 10, wins: 3, avgWin: 700, avgLoss: 200 },
  { trades: 20, wins: 12, avgWin: 80, avgLoss: 300 },
  { trades: 20, wins: 16, avgWin: 75, avgLoss: 400 },
  { trades: 10, wins: 8, avgWin: 100, avgLoss: 1000 },
  { trades: 20, wins: 11, avgWin: 100, avgLoss: 250 },
];

export const OUTCOMES_PILOTS: ScenePlan[] = OUTCOMES_PARAMS.map(outcomesPlan);
