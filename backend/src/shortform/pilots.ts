import { buildPublishedMetadata, type PublishedVideoMetadata } from "./metadata.js";
import { OFFICIAL_HANDLE, type Claim, type Mask, type Platform, type Rect, type SceneSpec, type ScenePlan } from "./types.js";

/**
 * The three pilot videos from the approved creative direction:
 *   Problem -> specific example -> visible evidence -> useful takeaway -> one relevant invitation.
 *
 * Every claim below points at a fact in scripts/video-factory/assets/verified-manifest.json. Where the
 * needed capture does not exist yet, the plan declares it in `requiredAssets` and stays blocked; it never
 * borrows an unrelated screen. Pilot narration that would need a number from a missing capture carries no
 * number yet: it is filled in after the capture, and the validator then checks it against the screenshot.
 */

export const PILOT_EXPERIMENT_ID = "exp-pilot-2026-09";
const VOICE = "edge-tts en-US-AndrewMultilingualNeural (pipeline default; the owner may replace it)";
const VISUAL_STYLE = "real-ui-crop-card-v1";

interface SceneInput {
  sceneId: string;
  variationId: string;
  narration: string;
  takeaway: string;
  assetId?: string | null;
  crop?: Rect | null;
  focal?: Rect | null;
  headline: string;
  caption: string;
  seconds: number;
  disclosure?: string | null;
  cta?: string | null;
  topics: string[];
  claims?: Claim[];
  first?: boolean;
  /** Only for a `screen_recording` assetId -- which part of the captured clip this scene uses. */
  clipTimeRangeSeconds?: { start: number; end: number };
  masks?: Mask[];
}

function scene(i: SceneInput): SceneSpec {
  const hasAsset = i.assetId !== undefined && i.assetId !== null;
  return {
    sceneId: i.sceneId,
    narration: i.narration,
    takeaway: i.takeaway,
    assetId: hasAsset ? i.assetId! : null,
    focalRegion: hasAsset ? (i.focal ?? i.crop ?? null) : null,
    crop: hasAsset ? (i.crop ?? null) : null,
    aspectRatio: "source",
    layout: "full_card",
    headline: i.headline,
    captionText: i.caption,
    durationSeconds: i.seconds,
    transition: i.first ? { type: "cut", durationSeconds: 0 } : { type: "fade", durationSeconds: 0.25 },
    disclosure: i.disclosure ?? null,
    cta: i.cta ?? null,
    platform: "both",
    experimentId: PILOT_EXPERIMENT_ID,
    variationId: i.variationId,
    expectedTopics: i.topics,
    claims: i.claims ?? [],
    masks: i.masks ?? [],
    clipTimeRangeSeconds: hasAsset ? i.clipTimeRangeSeconds : undefined,
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Pilot 1: "Green month. Losing setup."   Series: What the Total Hides                            */
/* ---------------------------------------------------------------------------------------------- */

const P1 = "p1-c"; // -c: phone-layout capture (2026-09-23), replacing the -b desktop capture
const P1_REC = "rec.p1-reports-setup-breakdown.v2";
/** Measured off the settled 1080x1920 frames: the Overview card grid, then the By setup card after the swipe. */
const P1_TOTAL_CROP: Rect = { x: 0, y: 615, w: 1080, h: 825 };
const P1_SETUP_CROP: Rect = { x: 0, y: 805, w: 1080, h: 507 };

export const PILOT_1: ScenePlan = {
  planId: "pilot-1-green-month-losing-setup",
  title: "Green month. Losing setup.",
  series: "What the Total Hides",
  topic: "A positive month total can hide a setup that loses money",
  hook: "Green month. Losing setup.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P1,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p1-s1-hook",
      variationId: P1,
      first: true,
      narration: "Green month. Losing setup.",
      takeaway: "A positive total does not mean every setup is working.",
      assetId: P1_REC,
      crop: P1_TOTAL_CROP,
      focal: P1_TOTAL_CROP,
      headline: "Green month. Losing setup.",
      caption: "$387.08 net, 22 of 22 trades.",
      seconds: 3.5,
      disclosure: "Demo data",
      topics: ["month_total"],
      clipTimeRangeSeconds: { start: 0.1, end: 4.5 },
      claims: [{ id: "p1-c1", type: "data_point", text: "Net P&L $387.08 across 22 of 22 trades, a positive month.", evidence: [{ assetId: P1_REC, factKey: "month.net_pnl" }] }],
    }),
    scene({
      sceneId: "p1-s2-setup-breakdown",
      variationId: P1,
      narration: "Break it down by setup, and one stands out: Opening Range Break, 8 trades, 25% win, negative $421.76.",
      takeaway: "Break a total down by setup to find the one that is not working.",
      assetId: P1_REC,
      crop: P1_SETUP_CROP,
      focal: P1_SETUP_CROP,
      headline: "Opening Range Break: -$421.76",
      caption: "8 trades, 25% win. The total hides it.",
      seconds: 6.5,
      disclosure: "Demo data",
      topics: ["setup_breakdown"],
      // Starts just before the swipe (4.53-5.73s) so the viewer sees the page move down to the breakdown.
      clipTimeRangeSeconds: { start: 4.35, end: 17.7 },
      claims: [{ id: "p1-c2", type: "data_point", text: "By setup, worst first: Opening Range Break has 8 trades, 25% win, -$421.76.", evidence: [{ assetId: P1_REC, factKey: "setup.opening_range_break_result" }] }],
    }),
    scene({
      sceneId: "p1-s3-qualify",
      variationId: P1,
      narration: "This is one example month, from recorded trades. Your own breakdown will look different.",
      takeaway: "The pattern is what to check for, not this specific month's numbers.",
      headline: "Based on recorded trades",
      caption: "Your own breakdown will look different.",
      seconds: 4,
      disclosure: "Not investment advice.",
      topics: ["setup_breakdown"],
      claims: [{ id: "p1-c3", type: "concept", text: "Qualifies that this is one example month's recorded trades, not a claim about any specific viewer's results.", evidence: [] }],
    }),
    scene({
      sceneId: "p1-s4-close",
      variationId: P1,
      narration: "Which setup would you review first?",
      takeaway: "Review the weakest setup, not the whole month.",
      headline: "Which setup do you review first?",
      caption: "Check your own breakdown by setup.",
      seconds: 2.5, // real edge-tts speech is 1.9s; was 4.0s authored-guess
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["setup_breakdown"],
      claims: [{ id: "p1-c4", type: "invitation", text: "Invites the viewer to review their own setups.", evidence: [] }],
    }),
  ],
};

/* ---------------------------------------------------------------------------------------------- */
/* Pilot 2: "Balance isn't your buffer."   Series: Read the Rule                                   */
/* ---------------------------------------------------------------------------------------------- */

const P2 = "p2-c"; // -c: phone-layout capture (2026-09-23): dashboard account context, then the rules card
const P2_REC = "rec.p2-rules-buffer.v2";
/** Dashboard Net P&L + Today cards (0-4.23s), then the account rules card after navigating to /rules. */
const P2_ACCOUNT_CROP: Rect = { x: 0, y: 1160, w: 1080, h: 430 };
const P2_RULES_CARD_CROP: Rect = { x: 0, y: 725, w: 1080, h: 465 };

export const PILOT_2: ScenePlan = {
  planId: "pilot-2-balance-isnt-your-buffer",
  title: "Balance isn't your buffer.",
  series: "Read the Rule",
  topic: "Profit or balance and the remaining drawdown buffer answer different questions",
  hook: "Balance isn't your buffer.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P2,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p2-s1-hook",
      variationId: P2,
      first: true,
      narration: "Balance isn't your buffer.",
      takeaway: "How much you are up says nothing about how close you are to a limit.",
      assetId: P2_REC,
      crop: P2_ACCOUNT_CROP,
      headline: "Balance isn't your buffer.",
      caption: "Account net: +$387.08.",
      seconds: 3,
      disclosure: "Demo data",
      topics: ["account_context"],
      clipTimeRangeSeconds: { start: 0.1, end: 4.2 },
      claims: [{ id: "p2-c1", type: "data_point", text: "The dashboard's Net P&L card shows +$387.08 (14 wins, 8 losses) -- a balance figure, not a buffer.", evidence: [{ assetId: P2_REC, factKey: "account.net_pnl_dashboard" }] }],
    }),
    scene({
      sceneId: "p2-s2-loss-and-profit",
      variationId: P2,
      narration: "Today's loss limit remaining reads $1,000.00, and profit target is $3,000.00, currently $387.08.",
      takeaway: "Profit, daily loss limit, and buffer are three separate numbers, not one.",
      assetId: P2_REC,
      crop: P2_RULES_CARD_CROP,
      headline: "Three separate numbers",
      caption: "Buffer $1,725.12. Loss limit $1,000.00. Target $3,000.00.",
      seconds: 6,
      disclosure: "Demo data",
      topics: ["buffer", "profit_target"],
      clipTimeRangeSeconds: { start: 4.25, end: 16.2 },
      claims: [
        { id: "p2-c1b", type: "data_point", text: "The account card shows a trailing drawdown buffer of $1,725.12, tracked separately from profit.", evidence: [{ assetId: P2_REC, factKey: "rule.trailing_drawdown_buffer" }] },
        { id: "p2-c2", type: "data_point", text: "Today's loss limit remaining is $1,000.00.", evidence: [{ assetId: P2_REC, factKey: "rule.daily_loss_limit_remaining" }] },
        { id: "p2-c3", type: "data_point", text: "Profit target $3,000.00, currently $387.08.", evidence: [{ assetId: P2_REC, factKey: "account.profit_target_progress" }] },
      ],
    }),
    scene({
      sceneId: "p2-s3-qualify",
      variationId: P2,
      narration: "These numbers depend on the trades you record and the rules you configure. Check your prop firm's own rules for the official limits.",
      takeaway: "The figures are only as good as the trades recorded and the settings entered.",
      headline: "Based on recorded trades",
      caption: "Results depend on the trades you record and the rules you set.",
      seconds: 7.3, // real edge-tts speech is 6.7s; was 8.5s authored-guess
      disclosure: "Not a broker or risk system.",
      topics: ["buffer"],
      claims: [{ id: "p2-c4", type: "concept", text: "Qualifies that results depend on recorded trades and correct settings.", evidence: [] }],
    }),
    scene({
      sceneId: "p2-s4-close",
      variationId: P2,
      narration: "Follow for more rule reads.",
      takeaway: "Read the rule before you trust the balance.",
      headline: "Read the rule.",
      caption: "Check your buffer, not just your balance.",
      seconds: 2.5, // real edge-tts speech is 1.9s; was 3.0s authored-guess
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["buffer"],
      claims: [{ id: "p2-c5", type: "invitation", text: "Invites the viewer to follow for more rule explainers.", evidence: [] }],
    }),
  ],
};

/* ---------------------------------------------------------------------------------------------- */
/* Pilot 3: "Same setup. Bigger size."   Series: One Trade to Review                               */
/* ---------------------------------------------------------------------------------------------- */

const P3 = "p3-c"; // -c: phone-layout capture (2026-09-23): the trade card, then the plan's own limit, one recording
const P3_REC = "rec.p3-trades-orb-size.v2";
/** The 2026-09-21 Opening Range Break trade card after the swipe, then the plan's "Max contracts per trade" field on /plan. */
const P3_RECENT_CROP: Rect = { x: 0, y: 831, w: 1080, h: 379 };
const P3_PLAN_CROP: Rect = { x: 60, y: 915, w: 960, h: 195 };

/**
 * Reframed 2026-09-23 after checking what the new local capture actually
 * supports. The old still-screenshot version (kept in git history, not
 * here) claimed the trade log itself tagged the bigger trade "Revenge
 * trade" -- true of that screenshot's dataset, but the new local fixture
 * (seed-pilot-fixtures.mjs) has no such tag on any trade, so that claim is
 * not available here and is not asserted. More importantly: the two
 * Opening Range Break trades this pilot compares are 24 DAYS apart
 * (2026-08-28 to 2026-09-21), not sequential trades -- checking the full
 * trade list, the trade immediately before the bigger one (any setup) was
 * actually a WIN, not a loss. There is no support here for "this happened
 * right after a loss," so the video never claims or implies that. What IS
 * directly observable and verifiable on screen: the same setup, used
 * twice, at 1 contract and then 5 -- and 5 is above the trading plan's own
 * written maxContracts of 3. That is the whole claim this version makes.
 *
 * Dropped the second "earliest trade" motion scene entirely on 2026-09-23:
 * this capture's scroll_to actions (scripted for nth=-1, the 2026-08-28
 * row further down the table) never actually produced visible scroll motion
 * -- frames pulled from the raw clip at t=2.2s and t=6s are pixel-identical,
 * both showing the same unscrolled top of the table. Rather than caption a
 * scene with a date/quantity that isn't verifiably on screen at that
 * clipTimeRangeSeconds, that scene is replaced with a text-only qualify
 * scene (no asset, no unverified visual claim) so every remaining second
 * of this pilot shows only what the capture actually demonstrates.
 */
export const PILOT_3: ScenePlan = {
  planId: "pilot-3-same-setup-bigger-size",
  title: "Same setup. Bigger size.",
  series: "One Trade to Review",
  topic: "The same setup, at a size that broke the written trading plan",
  hook: "Same setup. Bigger size.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P3,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p3-s1-recent",
      variationId: P3,
      first: true,
      narration: "Same setup. Bigger size. Five contracts, Opening Range Break, September 21st.",
      takeaway: "Compare the size of two trades in the same setup before drawing conclusions.",
      assetId: P3_REC,
      crop: P3_RECENT_CROP,
      focal: P3_RECENT_CROP,
      headline: "Same setup. Bigger size.",
      caption: "5 contracts, Opening Range Break.",
      seconds: 3,
      disclosure: "Demo data",
      topics: ["trade_size"],
      // Starts on the top of the list so the swipe (0.6-1.8s) that brings the trade into view is on screen.
      clipTimeRangeSeconds: { start: 0.2, end: 10.2 },
      claims: [{ id: "p3-c1", type: "data_point", text: "The most recent Opening Range Break trade used 5 contracts, on 2026-09-21.", evidence: [{ assetId: P3_REC, factKey: "trade.orb_qty5_most_recent" }] }],
    }),
    scene({
      sceneId: "p3-s2-qualify",
      variationId: P3,
      narration: "This is one trade from one recorded log. Your own trade log will look different.",
      takeaway: "The pattern to check is your own size against your own plan, not this specific trade.",
      headline: "Based on one recorded trade",
      caption: "Your own trade log will look different.",
      seconds: 4,
      disclosure: "Not investment advice.",
      topics: ["trade_size"],
      claims: [{ id: "p3-c2", type: "concept", text: "Qualifies that this is one example trade from one recorded log, not a claim about any specific viewer's trades.", evidence: [] }],
    }),
    scene({
      sceneId: "p3-s3-plan",
      variationId: P3,
      narration: "This trading plan caps size at 3 contracts. Five is over the plan, not just bigger than usual.",
      takeaway: "A size above the written plan is a fact you can check, not a guess about why.",
      assetId: P3_REC,
      crop: P3_PLAN_CROP,
      focal: P3_PLAN_CROP,
      headline: "Over the plan's own limit",
      caption: "The plan caps this setup at 3 contracts.",
      seconds: 5,
      // Starts at 11.7s, once the swipe has cleared the "Max trades per day: 5" field from this narrow window;
      // mid-swipe frames pair this field's label with the 5 above it, which would misread as "max contracts 5".
      clipTimeRangeSeconds: { start: 11.7, end: 20.55 },
      disclosure: "Demo data",
      topics: ["trade_size"],
      // Cites only the plan field shown in this scene's window; the "5 contracts" figure is cited in p3-s1-recent.
      claims: [{ id: "p3-c3", type: "data_point", text: "This trading plan's 'Max contracts per trade' field is set to 3.", evidence: [{ assetId: P3_REC, factKey: "plan.max_contracts" }] }],
    }),
    scene({
      sceneId: "p3-s4-close",
      variationId: P3,
      narration: "What's your own contract limit?",
      takeaway: "Check your own plan against your actual trade sizes.",
      headline: "What's your contract limit?",
      caption: "Compare your plan to your actual sizes.",
      seconds: 2.5,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["trade_size"],
      claims: [{ id: "p3-c4", type: "invitation", text: "Invites the viewer to check their own plan against their own trade sizes.", evidence: [] }],
    }),
  ],
};

/* ---------------------------------------------------------------------------------------------- */
/* Batch 2 (2026-09-25): six feature-led concepts, each built only on numbers the demo account's    */
/* own screens show, captured at phone layout (see runPilotCapture.ts pilot-4..pilot-9).           */
/* ---------------------------------------------------------------------------------------------- */

const QUALIFY_DEMO = "Not investment advice.";

const P4 = "p4-a";
const P4_REC = "rec.p4-account-health-consistency.v1";
export const PILOT_4: ScenePlan = {
  planId: "pilot-4-best-day-blocks-payout",
  title: "Your best day can block your payout.",
  series: "Read the Rule",
  topic: "A prop firm consistency cap can flag an account even when it is profitable",
  hook: "Your best day can block your payout.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P4,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p4-s1-hook",
      variationId: P4,
      first: true,
      narration: "Your best day can block your payout.",
      takeaway: "A consistency cap limits how much of your profit one day can be.",
      assetId: P4_REC,
      crop: { x: 0, y: 142, w: 1080, h: 388 },
      headline: "Your best day can block your payout.",
      caption: "Account health: 80 out of 100.",
      seconds: 3,
      disclosure: "Demo data",
      topics: ["account_health"],
      clipTimeRangeSeconds: { start: 1.7, end: 6.1 },
      claims: [{ id: "p4-c1", type: "data_point", text: "The account health score reads 80 out of 100.", evidence: [{ assetId: P4_REC, factKey: "health.score" }] }],
    }),
    scene({
      sceneId: "p4-s2-flag",
      variationId: P4,
      narration: "Fillbook flagged it: one day accounts for 46% of total profit, over this firm's 40% consistency cap.",
      takeaway: "The check names the exact number and the cap it crosses.",
      assetId: P4_REC,
      crop: { x: 0, y: 895, w: 1080, h: 360 },
      headline: "46% from one day. The cap is 40%.",
      caption: "Flagged as the most important action.",
      seconds: 7,
      disclosure: "Demo data",
      topics: ["consistency"],
      clipTimeRangeSeconds: { start: 6.0, end: 19.1 },
      claims: [{ id: "p4-c2", type: "data_point", text: "One day accounts for 46% of total profit, over the account's 40% consistency cap.", evidence: [{ assetId: P4_REC, factKey: "health.consistency_action" }] }],
    }),
    scene({
      sceneId: "p4-s3-qualify",
      variationId: P4,
      narration: "This is a sample account with demo data. Consistency rules differ by firm, so check your own agreement.",
      takeaway: "Confirm the rule in your own firm's agreement.",
      headline: "Rules differ by firm",
      caption: "Check the exact rule in your firm's agreement.",
      seconds: 6,
      disclosure: QUALIFY_DEMO,
      topics: ["consistency"],
      claims: [{ id: "p4-c3", type: "concept", text: "Qualifies that this is demo data and that consistency rules vary by firm.", evidence: [] }],
    }),
    scene({
      sceneId: "p4-s4-close",
      variationId: P4,
      narration: "Set your firm's rules once, and let your journal check every trade against them.",
      takeaway: "Catch a consistency problem before requesting a payout.",
      headline: "Catch it before you request a payout.",
      caption: "Try Fillbook on your own trades.",
      seconds: 3.5,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["consistency"],
      claims: [{ id: "p4-c4", type: "invitation", text: "Invites the viewer to set up their own firm rules in Fillbook.", evidence: [] }],
    }),
  ],
};

const P5 = "p5-a";
const P5_REC = "rec.p5-rule-simulator.v1";
export const PILOT_5: ScenePlan = {
  planId: "pilot-5-would-you-pass",
  title: "Would your trades pass?",
  series: "Read the Rule",
  topic: "Replaying logged trades against evaluation rules shows whether they would have passed",
  hook: "Would your trades pass a prop firm evaluation?",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P5,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p5-s1-hook",
      variationId: P5,
      first: true,
      narration: "Would your trades pass a prop firm evaluation?",
      takeaway: "You can test a rule set against trades you already took.",
      assetId: P5_REC,
      crop: { x: 0, y: 175, w: 1080, h: 235 },
      headline: "Would your trades pass?",
      caption: "Fillbook's rule simulator replays them.",
      seconds: 3,
      disclosure: "Demo data",
      topics: ["rule_simulator"],
      clipTimeRangeSeconds: { start: 0.1, end: 4.4 },
      claims: [{ id: "p5-c1", type: "data_point", text: "The rule simulator replays logged trades against a firm's evaluation rules.", evidence: [{ assetId: P5_REC, factKey: "simulator.description" }] }],
    }),
    scene({
      sceneId: "p5-s2-result",
      variationId: P5,
      narration: "It replays every logged trade against the rules. This sample had no breach, but missed the profit target, so it's not a pass.",
      takeaway: "No breach and a pass are different results.",
      assetId: P5_REC,
      crop: { x: 0, y: 165, w: 1080, h: 770 },
      headline: "No breach. Still not a pass.",
      caption: "The profit target is unmet on this sample.",
      seconds: 8,
      disclosure: "Demo data",
      topics: ["rule_simulator"],
      clipTimeRangeSeconds: { start: 4.35, end: 17.6 },
      claims: [{ id: "p5-c2", type: "data_point", text: "No active breach, but the profit target is unmet, so the evaluation is incomplete and not a pass.", evidence: [{ assetId: P5_REC, factKey: "simulator.result" }] }],
    }),
    scene({
      sceneId: "p5-s3-qualify",
      variationId: P5,
      narration: "A simulation on demo data can differ from a real evaluation. Confirm the firm's own published rules before you rely on it.",
      takeaway: "Always check the firm's published rules.",
      headline: "Simulated, not official",
      caption: "Confirm the firm's own published rules.",
      seconds: 6,
      disclosure: QUALIFY_DEMO,
      topics: ["rule_simulator"],
      claims: [{ id: "p5-c3", type: "concept", text: "Qualifies that a simulation on demo data can differ from a real evaluation.", evidence: [] }],
    }),
    scene({
      sceneId: "p5-s4-close",
      variationId: P5,
      narration: "Test a firm's rules on your own trades before you pay for the evaluation.",
      takeaway: "Check the rules against your own trades first.",
      headline: "Test before you pay.",
      caption: "Try the rule simulator at fillbookhq.com.",
      seconds: 3.5,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["rule_simulator"],
      claims: [{ id: "p5-c4", type: "invitation", text: "Invites the viewer to test rules on their own trades.", evidence: [] }],
    }),
  ],
};

const P6 = "p6-a";
const P6_REC = "rec.p6-edge-score.v1";
export const PILOT_6: ScenePlan = {
  planId: "pilot-6-edge-score",
  title: "One score for how you actually trade.",
  series: "What Your Journal Shows",
  topic: "One score that blends profitability, consistency, risk control and rule adherence",
  hook: "One score for how you actually trade.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P6,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p6-s1-hook",
      variationId: P6,
      first: true,
      narration: "One score for how you actually trade.",
      takeaway: "A single score summarizes several habits at once.",
      assetId: P6_REC,
      crop: { x: 0, y: 160, w: 1080, h: 300 },
      headline: "One score for how you trade.",
      caption: "Edge Score: 67, Developing.",
      seconds: 3,
      disclosure: "Demo data",
      topics: ["edge_score"],
      clipTimeRangeSeconds: { start: 1.9, end: 6.3 },
      claims: [{ id: "p6-c1", type: "data_point", text: "The Edge Score reads 67, Developing.", evidence: [{ assetId: P6_REC, factKey: "edge.score" }] }],
    }),
    scene({
      sceneId: "p6-s2-map",
      variationId: P6,
      narration: "It blends profitability, consistency, risk control and rule adherence. Rule adherence scores 87. Profitability, 59.",
      takeaway: "The breakdown shows which part is holding the score back.",
      assetId: P6_REC,
      crop: { x: 0, y: 160, w: 1080, h: 740 },
      headline: "Rules 87. Profitability 59.",
      caption: "Trend over the last 3 weeks: down 20.",
      seconds: 8,
      disclosure: "Demo data",
      topics: ["edge_score"],
      clipTimeRangeSeconds: { start: 6.3, end: 19.3 },
      claims: [{ id: "p6-c2", type: "data_point", text: "Edge map: profitability 59, consistency 63, risk control 69, rule adherence 87; trend over the last 3 weeks -20.", evidence: [{ assetId: P6_REC, factKey: "edge.map" }] }],
    }),
    scene({
      sceneId: "p6-s3-qualify",
      variationId: P6,
      narration: "This is demo data from a sample account. The score describes past trades, not future results.",
      takeaway: "The score is a look back, not a forecast.",
      headline: "Built from past trades",
      caption: "It describes what happened, not what will.",
      seconds: 5,
      disclosure: QUALIFY_DEMO,
      topics: ["edge_score"],
      claims: [{ id: "p6-c3", type: "concept", text: "Qualifies that the score is built from past demo trades and does not predict results.", evidence: [] }],
    }),
    scene({
      sceneId: "p6-s4-close",
      variationId: P6,
      narration: "Log your trades, and see your own Edge Score.",
      takeaway: "Find out which habit is holding your score back.",
      headline: "What's your score?",
      caption: "Log your trades at fillbookhq.com to see yours.",
      seconds: 3,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["edge_score"],
      claims: [{ id: "p6-c4", type: "invitation", text: "Invites the viewer to see their own score.", evidence: [] }],
    }),
  ],
};

const P7 = "p7-a";
const P7_REC = "rec.p7-daily-brief.v1";
export const PILOT_7: ScenePlan = {
  planId: "pilot-7-daily-brief",
  title: "Read this before your first trade.",
  series: "What Your Journal Shows",
  topic: "A short brief of last session, remaining buffer and strongest window before trading",
  hook: "Read this before your first trade.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P7,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p7-s1-hook",
      variationId: P7,
      first: true,
      narration: "Read this before your first trade.",
      takeaway: "A pre-session check takes seconds.",
      assetId: P7_REC,
      crop: { x: 0, y: 142, w: 1080, h: 398 },
      headline: "Read this before your first trade.",
      caption: "Fillbook's Daily Brief.",
      seconds: 2.5,
      disclosure: "Demo data",
      topics: ["daily_brief"],
      clipTimeRangeSeconds: { start: 1.7, end: 4.3 },
      claims: [{ id: "p7-c1", type: "data_point", text: "The Daily Brief shows the last session: -$17 on 1 trade.", evidence: [{ assetId: P7_REC, factKey: "brief.last_session" }] }],
    }),
    scene({
      sceneId: "p7-s2-brief",
      variationId: P7,
      narration: "Last session: down $17. $1,725 of buffer left, $1,000 of today's loss limit. Strongest window: the open, 64% win rate.",
      takeaway: "Three numbers worth knowing before the first trade.",
      assetId: P7_REC,
      crop: { x: 0, y: 142, w: 1080, h: 698 },
      headline: "Your day in three lines",
      caption: "Last session, buffer left, strongest window.",
      seconds: 10,
      disclosure: "Demo data",
      topics: ["daily_brief"],
      clipTimeRangeSeconds: { start: 3.8, end: 17.6 },
      claims: [
        { id: "p7-c2a", type: "data_point", text: "Last session: -$17 on 1 trade.", evidence: [{ assetId: P7_REC, factKey: "brief.last_session" }] },
        { id: "p7-c2", type: "data_point", text: "$1,725 of buffer to the floor and $1,000 of today's loss limit.", evidence: [{ assetId: P7_REC, factKey: "brief.account" }] },
        { id: "p7-c3", type: "data_point", text: "Strongest window: the open, 9:30-10:30am ET, 22 trades at a 64% win rate.", evidence: [{ assetId: P7_REC, factKey: "brief.window" }] },
      ],
    }),
    scene({
      sceneId: "p7-s3-qualify",
      variationId: P7,
      narration: "It's built from your logged trades and the rules you configure. This one is demo data.",
      takeaway: "The brief is only as good as the trades and rules entered.",
      headline: "Built from your own trades",
      caption: "Past results don't predict future ones.",
      seconds: 5,
      disclosure: QUALIFY_DEMO,
      topics: ["daily_brief"],
      claims: [{ id: "p7-c4", type: "concept", text: "Qualifies that the brief comes from logged trades and configured rules, shown with demo data.", evidence: [] }],
    }),
    scene({
      sceneId: "p7-s4-close",
      variationId: P7,
      narration: "Start every session knowing your numbers.",
      takeaway: "Check your numbers before the first trade.",
      headline: "Know your numbers first.",
      caption: "Get your own Daily Brief at fillbookhq.com.",
      seconds: 3,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["daily_brief"],
      claims: [{ id: "p7-c5", type: "invitation", text: "Invites the viewer to get their own brief.", evidence: [] }],
    }),
  ],
};

const P8 = "p8-a";
const P8_REC = "rec.p8-day-of-week.v1";
export const PILOT_8: ScenePlan = {
  planId: "pilot-8-red-weekday",
  title: "Four green weekdays. One red one.",
  series: "What the Total Hides",
  topic: "Splitting results by weekday shows the one day that loses money",
  hook: "Four green weekdays. One red one.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P8,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p8-s1-hook",
      variationId: P8,
      first: true,
      narration: "Four green weekdays. One red one.",
      takeaway: "A weekly total can hide one losing weekday.",
      assetId: P8_REC,
      crop: { x: 0, y: 142, w: 1080, h: 258 },
      headline: "Four green days. One red.",
      caption: "By day of week, Monday is -$57.32.",
      seconds: 2.5,
      disclosure: "Demo data",
      topics: ["day_of_week"],
      clipTimeRangeSeconds: { start: 1.9, end: 4.8 },
      claims: [{ id: "p8-c1", type: "data_point", text: "By day of week, Monday: 5 trades, -$57.32.", evidence: [{ assetId: P8_REC, factKey: "dow.monday" }] }],
    }),
    scene({
      sceneId: "p8-s2-breakdown",
      variationId: P8,
      narration: "Fillbook splits results by session day. Monday: five trades, negative $57.32. Tuesday: positive $157.12.",
      takeaway: "Look at each weekday on its own.",
      assetId: P8_REC,
      crop: { x: 0, y: 142, w: 1080, h: 543 },
      headline: "Monday: -$57.32",
      caption: "Tuesday +$157.12. Friday +$122.08.",
      seconds: 7,
      disclosure: "Demo data",
      topics: ["day_of_week"],
      clipTimeRangeSeconds: { start: 4.6, end: 17.8 },
      claims: [{ id: "p8-c2", type: "data_point", text: "Monday -$57.32, Tuesday +$157.12, Wednesday +$60.60, Thursday +$104.60, Friday +$122.08.", evidence: [{ assetId: P8_REC, factKey: "dow.all" }] }],
    }),
    scene({
      sceneId: "p8-s3-qualify",
      variationId: P8,
      narration: "This is one sample account's demo data. Your own weekdays will look different.",
      takeaway: "The pattern to check is your own, not these numbers.",
      headline: "Your days will differ",
      caption: "One sample account, demo data.",
      seconds: 5,
      disclosure: QUALIFY_DEMO,
      topics: ["day_of_week"],
      claims: [{ id: "p8-c3", type: "concept", text: "Qualifies that this is one sample account's demo data.", evidence: [] }],
    }),
    scene({
      sceneId: "p8-s4-close",
      variationId: P8,
      narration: "Which day is costing you money?",
      takeaway: "Find your own weakest weekday.",
      headline: "Which day costs you?",
      caption: "Find out at fillbookhq.com.",
      seconds: 3,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["day_of_week"],
      claims: [{ id: "p8-c4", type: "invitation", text: "Invites the viewer to check their own weekdays.", evidence: [] }],
    }),
  ],
};

const P9 = "p9-a";
const P9_REC = "rec.p9-payout-timeline.v1";
export const PILOT_9: ScenePlan = {
  planId: "pilot-9-payout-countdown",
  title: "129 trading days to payout.",
  series: "Read the Rule",
  topic: "Payout readiness and a pace-based timeline show how far a payout really is",
  hook: "At this pace, the payout is 129 trading days away.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P9,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p9-s1-hook",
      variationId: P9,
      first: true,
      narration: "At this pace, the payout is 129 trading days away.",
      takeaway: "Pace turns a profit target into a timeline.",
      assetId: P9_REC,
      crop: { x: 0, y: 570, w: 1080, h: 240 },
      headline: "129 trading days to payout",
      caption: "At $20.37 per trading day.",
      seconds: 3.5,
      disclosure: "Demo data",
      topics: ["payouts"],
      clipTimeRangeSeconds: { start: 1.7, end: 6.1 },
      claims: [{ id: "p9-c1", type: "data_point", text: "129 more trading days to payout-ready at the current pace of $20.37/day.", evidence: [{ assetId: P9_REC, factKey: "payout.timeline" }] }],
    }),
    scene({
      sceneId: "p9-s2-readiness",
      variationId: P9,
      narration: "Fillbook tracks each payout requirement: 13% of the profit target, minimum trading days met, and the best day over the consistency cap.",
      takeaway: "Every requirement is checked separately.",
      assetId: P9_REC,
      crop: { x: 0, y: 340, w: 1080, h: 630 },
      headline: "Payout readiness, check by check",
      caption: "Target 13%. Days met. Consistency over the cap.",
      seconds: 9,
      disclosure: "Demo data",
      topics: ["payouts"],
      clipTimeRangeSeconds: { start: 6.1, end: 19.1 },
      claims: [{ id: "p9-c2", type: "data_point", text: "No active rule breach; profit target 13% of the way (387.08 of 3000); 19 trading days meets the 10-day minimum; best single day is 46% of total profit, over the 40% cap.", evidence: [{ assetId: P9_REC, factKey: "payout.readiness" }] }],
    }),
    scene({
      sceneId: "p9-s3-qualify",
      variationId: P9,
      narration: "It's a projection from demo data, not a prediction. Confirm your firm's actual payout policy.",
      takeaway: "Check the payout policy with your firm.",
      headline: "A projection from demo data",
      caption: "Confirm your firm's payout policy.",
      seconds: 5,
      disclosure: QUALIFY_DEMO,
      topics: ["payouts"],
      claims: [{ id: "p9-c3", type: "concept", text: "Qualifies that the timeline is a projection from demo data.", evidence: [] }],
    }),
    scene({
      sceneId: "p9-s4-close",
      variationId: P9,
      narration: "Know exactly how far your payout is.",
      takeaway: "Track your own payout readiness.",
      headline: "How far is your payout?",
      caption: "Track yours at fillbookhq.com.",
      seconds: 3,
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["payouts"],
      claims: [{ id: "p9-c4", type: "invitation", text: "Invites the viewer to track their own payout readiness.", evidence: [] }],
    }),
  ],
};

export const PILOTS: ScenePlan[] = [PILOT_1, PILOT_2, PILOT_3, PILOT_4, PILOT_5, PILOT_6, PILOT_7, PILOT_8, PILOT_9];

/* ---------------------------------------------------------------------------------------------- */
/* Platform metadata for each pilot (built now, saved only after the owner publishes by hand).     */
/* ---------------------------------------------------------------------------------------------- */

const TIKTOK_TAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingPsychology", "TradingDiscipline"];
const YOUTUBE_TAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingDiscipline"];

const PILOT_COPY: Record<string, { topic: string; cta: string; captionBody: string; youtubeTitle: string }> = {
  [PILOT_1.planId]: {
    topic: PILOT_1.topic,
    cta: "Follow for more trade reviews",
    captionBody: "A positive month can still hide a setup that loses. Demo data, so check your own breakdown by setup.",
    youtubeTitle: "Green Month, Losing Setup: Read Your Setup Breakdown",
  },
  [PILOT_2.planId]: {
    topic: PILOT_2.topic,
    cta: "Follow for more rule reads",
    captionBody: "Your balance and your buffer answer different questions. Demo account, based on recorded trades and configured rules.",
    youtubeTitle: "Balance vs Drawdown Buffer: Read the Rule",
  },
  [PILOT_3.planId]: {
    topic: PILOT_3.topic,
    cta: "Follow for more trade reviews",
    captionBody: "Same setup, five times the size -- and over this plan's own contract limit. Demo data.",
    youtubeTitle: "Same Setup, Bigger Size: Check It Against Your Plan",
  },
  [PILOT_4.planId]: {
    topic: PILOT_4.topic,
    cta: "Follow for more rule reads",
    captionBody: "One profitable day can put an account over a consistency cap. Demo data, so check your own firm's rule.",
    youtubeTitle: "Your Best Day Can Block Your Payout: The Consistency Rule",
  },
  [PILOT_5.planId]: {
    topic: PILOT_5.topic,
    cta: "Follow for more rule reads",
    captionBody: "Replay trades you already took against evaluation rules. Demo data, and a simulation can differ from a real evaluation.",
    youtubeTitle: "Would Your Trades Pass a Prop Firm Evaluation?",
  },
  [PILOT_6.planId]: {
    topic: PILOT_6.topic,
    cta: "Follow for more trade reviews",
    captionBody: "One score blending profitability, consistency, risk control and rule adherence. Demo data.",
    youtubeTitle: "Edge Score: One Number for How You Actually Trade",
  },
  [PILOT_7.planId]: {
    topic: PILOT_7.topic,
    cta: "Follow for more trade reviews",
    captionBody: "Last session, buffer left and your strongest window, before the first trade. Demo data.",
    youtubeTitle: "Read This Before Your First Trade: The Daily Brief",
  },
  [PILOT_8.planId]: {
    topic: PILOT_8.topic,
    cta: "Follow for more trade reviews",
    captionBody: "Split results by weekday to find the day that loses. Demo data from one sample account.",
    youtubeTitle: "Four Green Weekdays, One Red One: Results by Day of Week",
  },
  [PILOT_9.planId]: {
    topic: PILOT_9.topic,
    cta: "Follow for more rule reads",
    captionBody: "Pace turns a profit target into a timeline. A projection from demo data, not a prediction.",
    youtubeTitle: "129 Trading Days to Payout: Tracking Payout Readiness",
  },
};

export function pilotMetadata(plan: ScenePlan, platform: Platform): PublishedVideoMetadata {
  const copy = PILOT_COPY[plan.planId];
  if (!copy) throw new Error(`No metadata copy for ${plan.planId}`);
  return buildPublishedMetadata(plan, platform, {
    title: platform === "youtube_shorts" ? copy.youtubeTitle : plan.title,
    captionBody: copy.captionBody,
    hashtags: platform === "tiktok" ? TIKTOK_TAGS : YOUTUBE_TAGS,
    topic: copy.topic,
    cta: copy.cta,
  });
}
