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
const P1_TOTAL_CROP: Rect = { x: 38, y: 635, w: 1004, h: 776 };
const P1_SETUP_CROP: Rect = { x: 38, y: 836, w: 1004, h: 458 };

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
const P2_ACCOUNT_CROP: Rect = { x: 38, y: 1183, w: 1004, h: 384 };
const P2_RULES_CARD_CROP: Rect = { x: 38, y: 757, w: 1004, h: 405 };

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
const P3_RECENT_CROP: Rect = { x: 36, y: 840, w: 1008, h: 364 };
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
      // Starts once the swipe (0.6-1.8s) has settled the trade inside the card crop; mid-swipe the crop shows a sliding, misaligned card.
      clipTimeRangeSeconds: { start: 1.8, end: 10.2 },
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
      crop: { x: 38, y: 196, w: 1004, h: 868 },
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
      crop: { x: 84, y: 908, w: 912, h: 326 },
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
      // A page heading, not a card: padded 40px on every side so its text sits inside the rounded card with a margin.
      crop: { x: 0, y: 160, w: 1080, h: 385 },
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
      crop: { x: 38, y: 197, w: 1004, h: 833 },
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
      crop: { x: 38, y: 192, w: 1004, h: 328 },
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
      crop: { x: 38, y: 235, w: 1004, h: 875 },
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
      crop: { x: 38, y: 205, w: 1004, h: 712 },
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
      crop: { x: 38, y: 205, w: 1004, h: 712 },
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
      crop: { x: 38, y: 205, w: 1004, h: 566 },
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
      crop: { x: 38, y: 205, w: 1004, h: 566 },
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
      crop: { x: 38, y: 577, w: 1004, h: 588 },
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
      crop: { x: 38, y: 205, w: 1004, h: 1030 },
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

/* ---------------------------------------------------------------------------------------------- */
/* Batch 3 (2026-09-25): behavior-led concepts recorded against a second demo account, "Pilot       */
/* Behavior Account" (the fillbook repo's frontend/scripts/seed-pilot-behavior-fixtures.mjs), see   */
/* runPilotCapture.ts's BATCH_3_SHOTS. Crops are measured card edges in the 1080x1920 recordings.   */
/* ---------------------------------------------------------------------------------------------- */

const B3_BEHAVIOR_REC = "rec.b3-insights-behavior.v1";
const B3_REPORTS_REC = "rec.b3-reports-timing-conviction.v1";
const B3_PLAN_REC = "rec.b3-plan-vs-reality.v1";
const B3_PROGRESS_REC = "rec.b3-progress.v1";
const B3_ACCOUNTS_REC = "rec.b3-accounts-overview.v1";
const B3_EDGE_REC = "rec.b3-your-edge.v1";
const B3_REVENGE_CROP: Rect = { x: 38, y: 213, w: 1004, h: 775 };
const B3_BEHAVIOR_LOWER_CROP: Rect = { x: 38, y: 995, w: 1004, h: 505 };
const B3_TAGS_CROP: Rect = { x: 38, y: 452, w: 1004, h: 731 };
const B3_TIMING_CROP: Rect = { x: 38, y: 207, w: 1004, h: 362 };
const B3_CONVICTION_CROP: Rect = { x: 38, y: 1087, w: 1004, h: 552 };
const B3_PLAN_CROP: Rect = { x: 38, y: 198, w: 1004, h: 784 };
const B3_FOCUS_CROP: Rect = { x: 80, y: 1208, w: 920, h: 302 };
const B3_WIN_RATE_CROP: Rect = { x: 38, y: 207, w: 1004, h: 370 };
const B3_PROGRESS_BEHAVIOR_CROP: Rect = { x: 38, y: 860, w: 1004, h: 780 };
const B3_ACCOUNTS_CROP: Rect = { x: 38, y: 208, w: 1004, h: 957 };
const B3_EDGE_CROP: Rect = { x: 38, y: 820, w: 1004, h: 647 };

interface B3Scene {
  narration: string;
  headline: string;
  caption: string;
  takeaway: string;
  topics: string[];
  /** Evidence scenes only. */
  asset?: { id: string; crop: Rect; clip: { start: number; end: number }; claim: string; factKey: string };
}

/** Builds a four-scene concept (hook, evidence, qualify, close) in the same shape as P1-P9. */
function batch3Plan(p: {
  n: number;
  slug: string;
  title: string;
  series: string;
  topic: string;
  scenes: [B3Scene, B3Scene, B3Scene, B3Scene];
}): ScenePlan {
  const variationId = `p${p.n}-a`;
  const ids = ["hook", "evidence", "qualify", "close"];
  return {
    planId: `pilot-${p.n}-${p.slug}`,
    title: p.title,
    series: p.series,
    topic: p.topic,
    hook: p.scenes[0].narration,
    experimentId: PILOT_EXPERIMENT_ID,
    variationId,
    platforms: ["tiktok", "youtube_shorts"],
    voice: VOICE,
    visualStyle: VISUAL_STYLE,
    requiredAssets: [],
    scenes: p.scenes.map((s, i) =>
      scene({
        sceneId: `p${p.n}-s${i + 1}-${ids[i]}`,
        variationId,
        first: i === 0,
        narration: s.narration,
        takeaway: s.takeaway,
        assetId: s.asset?.id,
        crop: s.asset?.crop,
        headline: s.headline,
        caption: s.caption,
        seconds: estimateSeconds(s.narration),
        disclosure: i < 2 ? "Demo data" : i === 2 ? QUALIFY_DEMO : null,
        cta: i === 3 ? `Follow ${OFFICIAL_HANDLE}` : null,
        topics: s.topics,
        clipTimeRangeSeconds: s.asset?.clip,
        claims: s.asset
          ? [{ id: `p${p.n}-c${i + 1}`, type: "data_point", text: s.asset.claim, evidence: [{ assetId: s.asset.id, factKey: s.asset.factKey }] }]
          : [{ id: `p${p.n}-c${i + 1}`, type: i === 3 ? "invitation" : "concept", text: s.takeaway, evidence: [] }],
      }),
    ),
  };
}

export const PILOT_10 = batch3Plan({
  n: 10,
  slug: "sized-up-after-a-loss",
  title: "Sized up 3 minutes after a loss.",
  series: "What Your Journal Shows",
  topic: "Revenge trades show up as a bigger size right after a loss",
  scenes: [
    { narration: "Sized up 3 minutes after a loss.", headline: "3 minutes after a loss", caption: "Sized 2.5x the usual.", takeaway: "Size right after a loss is worth checking.", topics: ["revenge_trading"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_REVENGE_CROP, clip: { start: 1.7, end: 6.2 }, claim: "A trade opened 3 min after losing $127, sized 2.5x the average.", factKey: "behavior.revenge" } },
    { narration: "Fillbook flagged it 5 times. Each one opened within 12 minutes of a loss, at up to 2.5 times the usual size.", headline: "5 revenge trades flagged", caption: "Opened 3 to 12 min after a loss.", takeaway: "The pattern repeats, and it can be counted.", topics: ["revenge_trading"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_REVENGE_CROP, clip: { start: 6.0, end: 17.7 }, claim: "5 possible revenge trades, opened 3 to 12 min after a loss at 1.5x to 2.5x the average size.", factKey: "behavior.revenge" } },
    { narration: "This is a demo account with seeded trades. A flag is a pattern to review, not a verdict.", headline: "A pattern, not a verdict", caption: "Demo account, seeded trades.", takeaway: "Treat a flag as something to review.", topics: ["revenge_trading"] },
    { narration: "Check what you do right after a loss.", headline: "Check your next trade.", caption: "See your own patterns at fillbookhq.com.", takeaway: "Look at the trade after the loss.", topics: ["revenge_trading"] },
  ],
});

export const PILOT_11 = batch3Plan({
  n: 11,
  slug: "six-trade-days",
  title: "Six trades on a 2.7-trade day.",
  series: "What Your Journal Shows",
  topic: "Overtrading shows up as sessions far above your normal trade count",
  scenes: [
    { narration: "Six trades. Your normal day is 2.7.", headline: "6 trades vs 2.7", caption: "Flagged as overtrading, three times.", takeaway: "Trade count is a behavior you can measure.", topics: ["overtrading"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_BEHAVIOR_LOWER_CROP, clip: { start: 1.7, end: 6.2 }, claim: "Overtraded sessions of 6 trades against a 2.7/day norm.", factKey: "behavior.overtraded" } },
    { narration: "Three sessions ran to 6 trades against a 2.7 a day norm. Two of them finished down $468.20 and $464.72.", headline: "3 sessions flagged", caption: "Two of them finished red.", takeaway: "The extra trades are where the damage lands.", topics: ["overtrading"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_BEHAVIOR_LOWER_CROP, clip: { start: 6.0, end: 17.7 }, claim: "3 overtraded sessions of 6 trades against a 2.7/day norm, two net -$468.20 and -$464.72.", factKey: "behavior.overtraded" } },
    { narration: "Demo account, seeded trades. Your own normal pace is the number that matters.", headline: "Your pace, not this one", caption: "Demo account, seeded trades.", takeaway: "Compare against your own normal.", topics: ["overtrading"] },
    { narration: "Know your normal before you break it.", headline: "Know your normal.", caption: "Track your pace at fillbookhq.com.", takeaway: "Set a cap from your own average.", topics: ["overtrading"] },
  ],
});

export const PILOT_12 = batch3Plan({
  n: 12,
  slug: "the-11-oclock-trades",
  title: "Your 11 o'clock trades win 25%.",
  series: "What the Total Hides",
  topic: "One hour of the day can lose while the rest of the session wins",
  scenes: [
    { narration: "These 11 o'clock trades win 25% of the time.", headline: "11:00: 25% win rate", caption: "Against 62% overall.", takeaway: "One hour can drag the whole day.", topics: ["time_of_day"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_BEHAVIOR_LOWER_CROP, clip: { start: 1.7, end: 6.2 }, claim: "Weak hour 11:00: 25% win rate across 20 timed trades, against 62% overall.", factKey: "behavior.weak_hour" } },
    { narration: "By time of day, the open wins 71% for $2,967.96. Late morning wins 24% and gives back $1,406.00.", headline: "Open vs late morning", caption: "Late morning: -$1,406.00.", takeaway: "Your best and worst hours are both in the log.", topics: ["time_of_day"],
      asset: { id: B3_REPORTS_REC, crop: B3_TIMING_CROP, clip: { start: 1.9, end: 17.9 }, claim: "Open 106 trades, 71% win, $2,967.96; late morning 25 trades, 24% win, -$1,406.00.", factKey: "timing.buckets" } },
    { narration: "This is seeded demo data. Your own hours will split differently.", headline: "Your hours will differ", caption: "Seeded demo data.", takeaway: "Check your own hours, not these.", topics: ["time_of_day"] },
    { narration: "Find the hour that costs you.", headline: "Find your worst hour.", caption: "Split your trades at fillbookhq.com.", takeaway: "Stop trading the hour that loses.", topics: ["time_of_day"] },
  ],
});

export const PILOT_13 = batch3Plan({
  n: 13,
  slug: "what-moving-your-stop-costs",
  title: "What does moving your stop cost?",
  series: "What Your Journal Shows",
  topic: "Tagging mistakes turns habits like moving a stop into a dollar figure",
  scenes: [
    { narration: "What does moving your stop actually cost?", headline: "The cost of a moved stop", caption: "Tagged habits, worst first.", takeaway: "A habit has a price once you tag it.", topics: ["mistake_tags"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_TAGS_CROP, clip: { start: 18.9, end: 22.8 }, claim: "Tagged habits ranked by net impact, worst first.", factKey: "tags.all" } },
    { narration: "Fillbook adds up your tagged mistakes. Moved stop: 4 trades, $655.84 lost. Chased price: $629.60.", headline: "Moved stop: -$655.84", caption: "Chased price: -$629.60.", takeaway: "The tags show which habit costs the most.", topics: ["mistake_tags"],
      asset: { id: B3_BEHAVIOR_REC, crop: B3_TAGS_CROP, clip: { start: 22.6, end: 34.9 }, claim: "Moved stop 4 trades, -$655.84; Chased price 10 trades, -$629.60.", factKey: "tags.all" } },
    { narration: "Demo account, seeded trades. The tags only count what you mark.", headline: "Only what you tag", caption: "Demo account, seeded trades.", takeaway: "Honest tags make honest totals.", topics: ["mistake_tags"] },
    { narration: "Put a price on your worst habit.", headline: "Price your worst habit.", caption: "Tag your trades at fillbookhq.com.", takeaway: "Start with the most expensive habit.", topics: ["mistake_tags"] },
  ],
});

export const PILOT_14 = batch3Plan({
  n: 14,
  slug: "would-you-take-it-again",
  title: "You already know your bad trades.",
  series: "What Your Journal Shows",
  topic: "Asking whether you would take a trade again separates good trades from bad ones",
  scenes: [
    { narration: "You already know which trades you shouldn't take.", headline: "Would you take it again?", caption: "One question after every trade.", takeaway: "Your own answer is a signal.", topics: ["conviction"],
      asset: { id: B3_REPORTS_REC, crop: B3_CONVICTION_CROP, clip: { start: 19.1, end: 22.9 }, claim: "By conviction: trades split by whether you would take them again.", factKey: "conviction.all" } },
    { narration: "Trades you'd take again: 84% win, $3,822.00. Trades you wouldn't: 18% win, down $2,575.96.", headline: "84% vs 18%", caption: "Wouldn't take again: -$2,575.96.", takeaway: "The trades you doubted are the ones that lost.", topics: ["conviction"],
      asset: { id: B3_REPORTS_REC, crop: B3_CONVICTION_CROP, clip: { start: 22.7, end: 35.1 }, claim: "Would take again 84% win, $3,822.00; wouldn't take again 18% win, -$2,575.96.", factKey: "conviction.all" } },
    { narration: "This is seeded demo data. Your answers are what make this work.", headline: "Your answers, your data", caption: "Seeded demo data.", takeaway: "Answer honestly and the split means something.", topics: ["conviction"] },
    { narration: "Ask yourself after every trade.", headline: "Ask after every trade.", caption: "Log yours at fillbookhq.com.", takeaway: "Skip the trades you wouldn't take again.", topics: ["conviction"] },
  ],
});

export const PILOT_15 = batch3Plan({
  n: 15,
  slug: "92-percent-on-plan",
  title: "92% on plan. The misses cost money.",
  series: "Read the Rule",
  topic: "Plan adherence per rule, and what the trades outside the plan did",
  scenes: [
    { narration: "92% on plan. The misses aren't random.", headline: "92% on plan", caption: "Checked rule by rule.", takeaway: "A plan score shows where you slip.", topics: ["plan_adherence"],
      asset: { id: B3_PLAN_REC, crop: B3_PLAN_CROP, clip: { start: 1.9, end: 6.4 }, claim: "Plan vs reality: 92% overall adherence.", factKey: "plan.adherence" } },
    { narration: "20 trades came outside the 9:30 to 11:30 window. They averaged negative $39.16 each, against $21.13 inside it.", headline: "Outside the window: -$39.16", caption: "Inside it: +$21.13 a trade.", takeaway: "The trades outside the plan are the losing ones.", topics: ["plan_adherence"],
      asset: { id: B3_PLAN_REC, crop: B3_FOCUS_CROP, clip: { start: 19.1, end: 35.1 }, claim: "20 trades outside 09:30-11:30 averaged -$39.16 each, against $21.13 inside.", factKey: "plan.focus" } },
    { narration: "Demo account and a sample plan. Your own rules decide the score.", headline: "Your rules, your score", caption: "Demo account, sample plan.", takeaway: "Write your own rules down first.", topics: ["plan_adherence"] },
    { narration: "Check your trades against your plan.", headline: "Check it against your plan.", caption: "Score yours at fillbookhq.com.", takeaway: "See which rule you break most.", topics: ["plan_adherence"] },
  ],
});

export const PILOT_16 = batch3Plan({
  n: 16,
  slug: "win-rate-76-to-55",
  title: "Win rate 76% to 55%. Here's why.",
  series: "What Your Journal Shows",
  topic: "Comparing recent trading against your own baseline shows what changed",
  scenes: [
    { narration: "Win rate: 76% before, 55% lately.", headline: "76% to 55%", caption: "Baseline vs recent trades.", takeaway: "Compare yourself against your own past.", topics: ["progress"],
      asset: { id: B3_PROGRESS_REC, crop: B3_WIN_RATE_CROP, clip: { start: 1.7, end: 6.2 }, claim: "Win rate baseline 76%, recent 55%.", factKey: "progress.win_rate" } },
    { narration: "Over the same stretch, flagged revenge trades went from 0% to 6%, and flagged overtrading days from 0% to 17%.", headline: "Flagged revenge: 0% to 6%", caption: "Flagged overtrading days: 0% to 17%.", takeaway: "The behavior changed before the results did.", topics: ["progress"],
      asset: { id: B3_PROGRESS_REC, crop: B3_PROGRESS_BEHAVIOR_CROP, clip: { start: 18.9, end: 34.9 }, claim: "Revenge-trade rate 0% to 6%; overtrading-day rate 0% to 17%.", factKey: "progress.behavior" } },
    { narration: "This is seeded demo data. Your own baseline is what you'd compare against.", headline: "Your own baseline", caption: "Seeded demo data.", takeaway: "Measure against yourself, not others.", topics: ["progress"] },
    { narration: "Find out what changed in your trading.", headline: "Find what changed.", caption: "Compare yours at fillbookhq.com.", takeaway: "Catch the change early.", topics: ["progress"] },
  ],
});

export const PILOT_17 = batch3Plan({
  n: 17,
  slug: "two-accounts-one-screen",
  title: "Two funded accounts. One screen.",
  series: "Read the Rule",
  topic: "Every prop account's buffer, limits and health side by side",
  scenes: [
    { narration: "Two funded accounts. Which one is closer to trouble?", headline: "Two accounts", caption: "All accounts at a glance.", takeaway: "Multiple accounts means multiple limits.", topics: ["accounts_overview"],
      asset: { id: B3_ACCOUNTS_REC, crop: B3_ACCOUNTS_CROP, clip: { start: 1.9, end: 6.4 }, claim: "All accounts at a glance lists 2 accounts.", factKey: "accounts.overview" } },
    { narration: "Each account shows its buffer, today's limit, target progress and health. This one's best day is 46% of profit, over its 40% cap.", headline: "Best day: 46% of 40% cap", caption: "Health 80 out of 100.", takeaway: "The problem account stands out on one screen.", topics: ["accounts_overview"],
      asset: { id: B3_ACCOUNTS_REC, crop: B3_ACCOUNTS_CROP, clip: { start: 6.2, end: 19.9 }, claim: "Each account shows buffer, today's limit, % to target and health; one account's best day is 46% of a 40% cap.", factKey: "accounts.overview" } },
    { narration: "Demo accounts with seeded trades. Your firm's own rules set the real limits.", headline: "Your firm sets the limits", caption: "Demo accounts, seeded trades.", takeaway: "Confirm limits with your firm.", topics: ["accounts_overview"] },
    { narration: "See every account before you trade.", headline: "See every account.", caption: "Track yours at fillbookhq.com.", takeaway: "Check the weakest account first.", topics: ["accounts_overview"] },
  ],
});

export const PILOT_18 = batch3Plan({
  n: 18,
  slug: "your-best-setup-by-the-numbers",
  title: "Your best setup, by the numbers.",
  series: "What Your Journal Shows",
  topic: "Finding the setup and time window that actually work",
  scenes: [
    { narration: "Your best setup, by the numbers.", headline: "Your strongest edge", caption: "Found in your own trades.", takeaway: "Know what to do more of.", topics: ["edge"],
      asset: { id: B3_EDGE_REC, crop: B3_EDGE_CROP, clip: { start: 1.7, end: 6.2 }, claim: "Your Edge: strongest setup and strongest window.", factKey: "edge.strongest" } },
    { narration: "Order Block Retest: 48 trades, 88% win rate. The strongest window is the open, 71% across 106 trades.", headline: "Order Block Retest: 88%", caption: "Best window: the open, 71%.", takeaway: "Your edge has a setup and a time.", topics: ["edge"],
      asset: { id: B3_EDGE_REC, crop: B3_EDGE_CROP, clip: { start: 6.0, end: 19.7 }, claim: "Order Block Retest 48 trades, 88% win rate; strongest window the open, 106 trades, 71% win rate.", factKey: "edge.strongest" } },
    { narration: "This is seeded demo data. Past patterns don't promise future ones.", headline: "Past, not a forecast", caption: "Seeded demo data.", takeaway: "Treat an edge as a pattern to keep testing.", topics: ["edge"] },
    { narration: "Find the setup that's working for you.", headline: "Find your edge.", caption: "See yours at fillbookhq.com.", takeaway: "Do more of what works.", topics: ["edge"] },
  ],
});

const BATCH_3_PLANS: ScenePlan[] = [PILOT_10, PILOT_11, PILOT_12, PILOT_13, PILOT_14, PILOT_15, PILOT_16, PILOT_17, PILOT_18];
const BATCH_3_COPY: Record<string, { captionBody: string; youtubeTitle: string; cta: string }> = {
  [PILOT_10.planId]: { captionBody: "Five trades opened minutes after a loss, at up to 2.5x the usual size. Demo data from a seeded account.", youtubeTitle: "Sized Up 3 Minutes After a Loss: Flagging Possible Revenge Trades", cta: "Follow for more trade reviews" },
  [PILOT_11.planId]: { captionBody: "Sessions that ran to 6 trades against a 2.7-trade normal day. Demo data from a seeded account.", youtubeTitle: "Six Trades on a 2.7-Trade Day: Flagging Possible Overtrading", cta: "Follow for more trade reviews" },
  [PILOT_12.planId]: { captionBody: "The open wins, late morning loses. Split your trades by hour to find yours. Demo data.", youtubeTitle: "Your 11 O'Clock Trades Win 25%: Results by Time of Day", cta: "Follow for more trade reviews" },
  [PILOT_13.planId]: { captionBody: "Tag your mistakes and see what each habit costs. Demo data from a seeded account.", youtubeTitle: "What Moving Your Stop Costs: Pricing Your Trading Habits", cta: "Follow for more trade reviews" },
  [PILOT_14.planId]: { captionBody: "Trades you'd take again vs trades you wouldn't: 84% win vs 18%. Demo data.", youtubeTitle: "Would You Take It Again? What Your Doubts Are Telling You", cta: "Follow for more trade reviews" },
  [PILOT_15.planId]: { captionBody: "92% on plan, and the trades outside the window lost money. Demo account and a sample plan.", youtubeTitle: "92% on Plan: What the Trades Outside It Cost", cta: "Follow for more rule reads" },
  [PILOT_16.planId]: { captionBody: "Compare recent trading to your own baseline to see what changed. Demo data.", youtubeTitle: "Win Rate Fell From 76% to 55%: Comparing Against Your Baseline", cta: "Follow for more trade reviews" },
  [PILOT_17.planId]: { captionBody: "Every prop account's buffer, limits and health on one screen. Demo accounts with seeded trades.", youtubeTitle: "Two Funded Accounts, One Screen: Tracking Every Account's Limits", cta: "Follow for more rule reads" },
  [PILOT_18.planId]: { captionBody: "The setup and time window that actually work, from your own trades. Demo data.", youtubeTitle: "Your Best Setup by the Numbers: Finding Your Edge", cta: "Follow for more trade reviews" },
};

for (const plan of BATCH_3_PLANS) PILOT_COPY[plan.planId] = { topic: plan.topic, ...BATCH_3_COPY[plan.planId]! };

/* ---------------------------------------------------------------------------------------------- */
/* Angles (2026-09-25): the owner now posts 3 videos a day. Each angle re-cuts one verified concept  */
/* with a new hook and narration over the SAME footage, crops, clip windows and fact citations, so   */
/* every number stays checked against its recording. Numbers in narration must come from the facts  */
/* the scene already cites; validateScenePlan enforces that for every plan in PILOTS.               */
/* ---------------------------------------------------------------------------------------------- */

interface AngleScene {
  narration: string;
  headline: string;
  caption: string;
  takeaway: string;
  /** A different window of the same recording; only where the scene's cited facts are on screen for all of it. */
  clip?: { start: number; end: number };
}

interface AngleSpec {
  key: string;
  title: string;
  hook: string;
  topic: string;
  /** One entry per scene of the base plan, in the same order. */
  scenes: AngleScene[];
  captionBody: string;
  youtubeTitle: string;
}

/** Speech runs about 2.7 words a second at the production voice's +8% rate; padded to the next half second. */
function estimateSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).length;
  return Math.max(2.5, Math.ceil((words / 2.7 + 0.4) * 2) / 2);
}

const ANGLE_COPY: Record<string, { topic: string; cta: string; captionBody: string; youtubeTitle: string }> = {};

function angleOf(base: ScenePlan, spec: AngleSpec): ScenePlan {
  if (spec.scenes.length !== base.scenes.length) throw new Error(`${base.planId}/${spec.key}: ${spec.scenes.length} scene texts for ${base.scenes.length} scenes`);
  const variationId = `${base.variationId}-${spec.key}`;
  const plan: ScenePlan = {
    ...base,
    planId: `${base.planId}--${spec.key}`,
    title: spec.title,
    hook: spec.hook,
    topic: spec.topic,
    variationId,
    scenes: base.scenes.map((s, i) => {
      const text = spec.scenes[i]!;
      return {
        ...s,
        sceneId: `${s.sceneId}-${spec.key}`,
        variationId,
        narration: text.narration,
        takeaway: text.takeaway,
        headline: text.headline,
        captionText: text.caption,
        durationSeconds: estimateSeconds(text.narration),
        clipTimeRangeSeconds: text.clip ?? s.clipTimeRangeSeconds,
        claims: s.claims.map((c) => ({ ...c, id: `${c.id}-${spec.key}` })),
      };
    }),
  };
  const baseCopy = PILOT_COPY[base.planId]!;
  ANGLE_COPY[plan.planId] = { topic: spec.topic, cta: baseCopy.cta, captionBody: spec.captionBody, youtubeTitle: spec.youtubeTitle };
  return plan;
}

export const PILOT_ANGLES: ScenePlan[] = [
  angleOf(PILOT_1, {
    key: "b",
    title: "64% win rate. One setup still loses.",
    hook: "64% win rate. One setup still loses.",
    topic: "A strong overall win rate can sit on top of one losing setup",
    scenes: [
      { narration: "64% win rate. One setup still loses.", headline: "64% win rate", caption: "22 trades, $387.08 net.", takeaway: "A good overall win rate can hide one bad setup." },
      { narration: "Sorted worst first, it's Opening Range Break: 8 trades, 25% win, down $421.76.", headline: "The setup behind the losses", caption: "Opening Range Break: 8 trades, -$421.76.", takeaway: "Sort setups worst first to find the leak." },
      { narration: "This is one example month of recorded trades. Your own setups will sort differently.", headline: "One example month", caption: "Your own setups will sort differently.", takeaway: "Check your own setups, not these numbers." },
      { narration: "Sort your own setups, worst first.", headline: "Sort your setups worst first.", caption: "See your breakdown at fillbookhq.com.", takeaway: "Start the review from the weakest setup." },
    ],
    captionBody: "A 64% win rate can still hide a setup that loses. Demo data, so sort your own setups worst first.",
    youtubeTitle: "64% Win Rate, One Losing Setup: Sort Your Setups Worst First",
  }),
  angleOf(PILOT_1, {
    key: "c",
    title: "The month total hides your worst setup.",
    hook: "A green month. Here's what it hides.",
    topic: "A month total averages a losing setup away",
    scenes: [
      { narration: "A green month. Here's what it hides.", headline: "The total hides something", caption: "$387.08 net across 22 trades.", takeaway: "A month total blends every setup together." },
      { narration: "One setup, Opening Range Break, lost $421.76 over 8 trades at a 25% win rate.", headline: "One setup: -$421.76", caption: "Opening Range Break, 8 trades, 25% win.", takeaway: "One setup can carry most of the losses." },
      { narration: "These are recorded demo trades from one month. Yours will tell a different story.", headline: "Recorded demo trades", caption: "Your month will tell a different story.", takeaway: "The check matters more than these numbers." },
      { narration: "Look past the total this month.", headline: "Look past the total.", caption: "Break your month down by setup.", takeaway: "Break the month down before you judge it." },
    ],
    captionBody: "A positive month can average away a setup that keeps losing. Demo data, so check your own month by setup.",
    youtubeTitle: "What Your Month Total Hides: One Losing Setup",
  }),
  angleOf(PILOT_2, {
    key: "b",
    title: "Up $387. How much room is left?",
    hook: "You're up. How much room is left?",
    topic: "Being up on the account says nothing about the drawdown room left",
    scenes: [
      { narration: "You're up. How much room is left?", headline: "Up $387.08", caption: "14 wins, 8 losses.", takeaway: "Profit and room left are different questions." },
      { narration: "The trailing drawdown buffer is $1,725.12, with $1,000.00 left on today's loss limit. That's the real room.", headline: "Room left: $1,725.12", caption: "Today's loss limit left: $1,000.00.", takeaway: "The buffer is the number that ends accounts." },
      { narration: "These figures come from the trades you record and the rules you configure. Your firm's rules are the official limits.", headline: "From your recorded trades", caption: "Your firm's rules are the official limits.", takeaway: "The figures depend on the trades and rules entered." },
      { narration: "Check the room, not the balance.", headline: "Check the room.", caption: "Your buffer, not your balance.", takeaway: "Know the room before you size up." },
    ],
    captionBody: "Profit tells you how you're doing. The buffer tells you how much room is left. Demo account, based on recorded trades and configured rules.",
    youtubeTitle: "Up $387, but How Much Room Is Left? The Drawdown Buffer",
  }),
  angleOf(PILOT_2, {
    key: "c",
    title: "14 wins and 13% of the target.",
    hook: "14 wins. Still far from the target.",
    topic: "Progress toward a profit target is its own number, separate from wins and losses",
    scenes: [
      { narration: "14 wins. Still far from the target.", headline: "14 wins, 8 losses", caption: "Net P&L: +$387.08.", takeaway: "A winning record isn't the same as progress." },
      { narration: "The profit target is $3,000.00, currently $387.08. Today's loss limit remaining is $1,000.00.", headline: "13% of the target", caption: "Target $3,000.00. Loss limit left $1,000.00.", takeaway: "Track the target separately from the record." },
      { narration: "These numbers depend on the trades you record and the rules you configure. Confirm the targets with your prop firm.", headline: "Based on recorded trades", caption: "Confirm the targets with your firm.", takeaway: "The firm's own rules set the real target." },
      { narration: "Track the target, not just the wins.", headline: "Track the target.", caption: "Not just the win count.", takeaway: "Measure progress against the target." },
    ],
    captionBody: "A winning record and progress toward the profit target are two different numbers. Demo account, based on recorded trades and configured rules.",
    youtubeTitle: "14 Wins and Only 13% of the Target: Tracking Profit Target Progress",
  }),
  angleOf(PILOT_3, {
    key: "b",
    title: "One trade broke the plan.",
    hook: "One trade broke the plan.",
    topic: "A single trade sized above the written plan's contract limit",
    scenes: [
      { narration: "One trade broke the plan. Five contracts, Opening Range Break, a $257.40 loss.", headline: "One trade broke the plan.", caption: "5 contracts, -$257.40.", takeaway: "Check a losing trade's size against the plan." },
      { narration: "This is one trade from one recorded log. Your own log will show your own sizes.", headline: "One recorded trade", caption: "Your own log will show your own sizes.", takeaway: "The check is your size against your plan." },
      { narration: "The written plan caps every trade at 3 contracts. That trade was over it before it ever lost.", headline: "The plan said 3", caption: "Max contracts per trade: 3.", takeaway: "Size above the plan is a fact you can check." },
      { narration: "Check your last loss against your plan.", headline: "Check your last loss.", caption: "Compare its size to your plan.", takeaway: "Start with the size, not the story." },
    ],
    captionBody: "Five contracts on a plan that allows three. Demo data, so check your own trades against your own plan.",
    youtubeTitle: "One Trade Broke the Plan: Checking Size Against Your Trading Plan",
  }),
  angleOf(PILOT_3, {
    key: "c",
    title: "Your plan has a size limit. Check it.",
    hook: "Your plan has a size limit. This trade used 5 contracts.",
    topic: "Comparing a real trade's size to the plan's written maximum",
    scenes: [
      { narration: "Your plan has a size limit. This trade used 5 contracts.", headline: "5 contracts", caption: "Opening Range Break, September 21st.", takeaway: "Every trade's size can be checked." },
      { narration: "One trade, from one recorded demo log. The point is the check, not this trade.", headline: "One recorded demo trade", caption: "The point is the check, not this trade.", takeaway: "Run the same check on your own trades." },
      { narration: "Max contracts per trade here is 3, written into the trading plan before the trade.", headline: "Plan limit: 3 contracts", caption: "Written before the trade, not after.", takeaway: "A written limit turns size into a yes or no." },
      { narration: "Write your size limit down first.", headline: "Write your limit down.", caption: "Then check every trade against it.", takeaway: "A limit only works if it's written." },
    ],
    captionBody: "A written size limit makes every trade checkable. Demo data from one recorded log.",
    youtubeTitle: "Your Plan Has a Size Limit: 5 Contracts vs a Max of 3",
  }),
  angleOf(PILOT_4, {
    key: "b",
    title: "Healthy account. Payout still at risk.",
    hook: "Health score 80. Payout still at risk.",
    topic: "A healthy account score can still carry a consistency-rule problem",
    scenes: [
      { narration: "Health score 80. Payout still at risk.", headline: "Health: 80 out of 100", caption: "Healthy, with one problem.", takeaway: "A good score can still hide a payout problem." },
      { narration: "The most important action: one day is 46% of total profit, and this firm caps it at 40%.", headline: "One day: 46% of profit", caption: "This firm's cap is 40%.", takeaway: "The flag names the day's share and the cap." },
      { narration: "This is demo data from a sample account. Every firm writes its consistency rule differently.", headline: "Every firm differs", caption: "Read your own firm's consistency rule.", takeaway: "Confirm the rule in your own agreement." },
      { narration: "Check your best day before you request a payout.", headline: "Check your best day.", caption: "Before you request a payout.", takeaway: "Catch the cap before the request." },
    ],
    captionBody: "An account can look healthy and still be over a consistency cap. Demo data, so check your own firm's rule.",
    youtubeTitle: "Healthy Account, Payout Still at Risk: The Consistency Cap",
  }),
  angleOf(PILOT_4, {
    key: "c",
    title: "The rule that blocks profitable traders.",
    hook: "The rule that blocks profitable traders from payouts.",
    topic: "How a consistency cap can hold up a payout for a profitable account",
    scenes: [
      { narration: "The rule that blocks profitable traders from payouts.", headline: "The payout blocker", caption: "Account health: 80 out of 100.", takeaway: "Being profitable isn't the only payout test." },
      { narration: "It's the consistency cap. Here one day made 46% of the profit, over a 40% cap, and Fillbook flags it first.", headline: "Consistency cap: 40%", caption: "Best day: 46% of total profit.", takeaway: "The biggest day can be the problem." },
      { narration: "Sample account, demo data. Caps and how they're measured vary by firm.", headline: "Caps vary by firm", caption: "Check how your firm measures it.", takeaway: "Know your firm's exact rule." },
      { narration: "Know your cap before your best day happens.", headline: "Know your cap first.", caption: "Try Fillbook on your own trades.", takeaway: "Plan around the cap, not after it." },
    ],
    captionBody: "A consistency cap can hold up a payout even when the account is profitable. Demo data, so check your own firm's rule.",
    youtubeTitle: "The Consistency Rule That Blocks Profitable Traders",
  }),
  angleOf(PILOT_5, {
    key: "b",
    title: "No breach doesn't mean you passed.",
    hook: "No breach doesn't mean you passed.",
    topic: "Surviving an evaluation's limits and passing it are different results",
    scenes: [
      { narration: "No breach doesn't mean you passed.", headline: "No breach. Passed?", caption: "The rule simulator checks both.", takeaway: "Survival and passing are different tests." },
      { narration: "Replaying the logged trades, nothing would have ended the account, but a requirement is still unmet. That's not a pass.", headline: "Survived isn't passed.", caption: "A requirement is still unmet.", takeaway: "Check every requirement, not just the limits." },
      { narration: "This is a simulation on demo data. The firm's own published rules decide the real result.", headline: "A simulation, not the result", caption: "The firm's published rules decide.", takeaway: "Use the firm's rules as the final word." },
      { narration: "Check every requirement, not just the limits.", headline: "Check every requirement.", caption: "Not just the drawdown limits.", takeaway: "Passing needs every box checked." },
    ],
    captionBody: "Not breaching a rule and passing an evaluation are different results. Demo data, and a simulation can differ from a real evaluation.",
    youtubeTitle: "No Breach Isn't a Pass: Replaying Trades Against Evaluation Rules",
  }),
  angleOf(PILOT_5, {
    key: "c",
    title: "Test a prop firm before you pay for it.",
    hook: "Test a prop firm before you pay for it.",
    topic: "Replaying past trades against a firm's rules before buying an evaluation",
    scenes: [
      { narration: "Test a prop firm before you pay for it.", headline: "Test the firm first", caption: "Replay trades you already took.", takeaway: "Your past trades can test a firm's rules." },
      { narration: "The simulator replays your logged trades against the firm's rules, requirement by requirement.", headline: "Requirement by requirement", caption: "No breach, but not a pass yet.", takeaway: "See which requirement is the one you miss." },
      { narration: "Simulated results on demo data can differ from a real evaluation. Always read the firm's published rules.", headline: "Simulated, not official", caption: "Read the firm's published rules.", takeaway: "The published rules are the real rules." },
      { narration: "Know which firm fits your trading before you buy.", headline: "Know before you buy.", caption: "Try the rule simulator at fillbookhq.com.", takeaway: "Pick the firm your trades fit." },
    ],
    captionBody: "Replay trades you already took against a firm's rules before paying for the evaluation. Demo data, and a simulation can differ from a real evaluation.",
    youtubeTitle: "Test a Prop Firm Before You Pay: The Rule Simulator",
  }),
  angleOf(PILOT_6, {
    key: "b",
    title: "Your P&L is only part of the picture.",
    hook: "Your P&L is only part of the picture.",
    topic: "A score that shows which habit, not just which trade, is weakest",
    scenes: [
      { narration: "Your P&L is only part of the picture.", headline: "P&L is one part", caption: "Edge Score: 67, Developing.", takeaway: "One number can hide several habits." },
      { narration: "Risk control scores 69 and consistency 63, while profitability trails at 59.", headline: "Profitability is the weak spot", caption: "Profitability 59. Consistency 63. Risk 69.", takeaway: "The breakdown shows what to work on." },
      { narration: "Demo data, built from past trades. It describes what happened, not what will.", headline: "A look back", caption: "Built from past trades, not a forecast.", takeaway: "The score reviews the past." },
      { narration: "Find the habit that's holding you back.", headline: "Find your weak spot.", caption: "See your own score at fillbookhq.com.", takeaway: "Work on the lowest part first." },
    ],
    captionBody: "P&L is one number. The breakdown shows which habit is weakest. Demo data.",
    youtubeTitle: "Your P&L Is Only Part of the Picture: The Edge Score Breakdown",
  }),
  angleOf(PILOT_6, {
    key: "c",
    title: "Rules 87. Still trending down.",
    hook: "Edge Score 67. Here's what's dragging it.",
    topic: "A trend line that falls even while rule adherence stays high",
    scenes: [
      { narration: "Edge Score 67. Here's what's dragging it.", headline: "Edge Score: 67", caption: "Developing.", takeaway: "Look under the score, not just at it." },
      { narration: "Over the last 3 weeks the trend is down 20, even with rule adherence at 87.", headline: "Trend: down 20", caption: "Rule adherence still 87.", takeaway: "Following rules and trending well are different." },
      { narration: "This is a sample account's demo data. It looks back at trades, it doesn't predict them.", headline: "Demo data, looking back", caption: "It describes, it doesn't predict.", takeaway: "Treat it as a review, not a forecast." },
      { narration: "Watch the trend, not just the score.", headline: "Watch the trend.", caption: "Log your trades at fillbookhq.com.", takeaway: "Direction matters as much as level." },
    ],
    captionBody: "Rule adherence can stay high while the overall trend falls. Demo data.",
    youtubeTitle: "Rules 87, Still Trending Down: Reading the Edge Score",
  }),
  angleOf(PILOT_7, {
    key: "b",
    title: "Your best hour, before you trade.",
    hook: "Your best hour, before you trade.",
    topic: "Knowing your strongest trading window before the session starts",
    scenes: [
      { narration: "Your best hour, before you trade.", headline: "Your best hour", caption: "From the Daily Brief.", takeaway: "Know when you trade best.", clip: { start: 1.7, end: 5.2 } },
      { narration: "The brief shows the strongest window: the open, 9:30 to 10:30, 22 trades at a 64% win rate.", headline: "Strongest window: the open", caption: "22 trades, 64% win rate.", takeaway: "Your best window is worth knowing daily.", clip: { start: 5.0, end: 17.6 } },
      { narration: "It comes from your logged trades and the rules you set. This one is demo data.", headline: "From your logged trades", caption: "Past results don't predict future ones.", takeaway: "The brief reflects what you entered." },
      { narration: "Trade your best window on purpose.", headline: "Trade it on purpose.", caption: "Get your own brief at fillbookhq.com.", takeaway: "Plan the session around your strongest hour." },
    ],
    captionBody: "Your strongest trading window, shown before the first trade. Demo data.",
    youtubeTitle: "Your Best Trading Hour, Before You Trade: The Daily Brief",
  }),
  angleOf(PILOT_7, {
    key: "c",
    title: "Know your limit before the open.",
    hook: "Know your limit before the open.",
    topic: "Checking today's loss limit and buffer before the session",
    scenes: [
      { narration: "Know your limit before the open.", headline: "Your limit, first", caption: "From the Daily Brief.", takeaway: "Start with the limit, not the chart.", clip: { start: 1.7, end: 5.2 } },
      { narration: "The brief says $1,000 of today's loss limit is available, with $1,725 above the drawdown floor. Yesterday cost $17 on a single trade.", headline: "$1,000 of room today", caption: "Buffer to the floor: $1,725.", takeaway: "Two limits, both worth knowing before you trade.", clip: { start: 5.0, end: 17.7 } },
      { narration: "Sample account, demo numbers. The brief only knows what you log and the limits you enter.", headline: "Only what you enter", caption: "Past results don't predict future ones.", takeaway: "The limits are only as good as the rules entered." },
      { narration: "Read your limits before the first trade.", headline: "Read your limits first.", caption: "Get your own brief at fillbookhq.com.", takeaway: "Know the room before you use it." },
    ],
    captionBody: "Today's loss limit and your buffer to the floor, before the first trade. Demo data.",
    youtubeTitle: "Know Your Loss Limit Before the Open: The Daily Brief",
  }),
  angleOf(PILOT_8, {
    key: "b",
    title: "Mondays cost this account money.",
    hook: "Mondays cost this account money.",
    topic: "One weekday that loses while the rest are green",
    scenes: [
      { narration: "Mondays cost this account money.", headline: "The red day: Monday", caption: "Monday: -$57.32.", takeaway: "One weekday can be the leak.", clip: { start: 1.9, end: 5.4 } },
      { narration: "Monday: five trades, down $57.32. Every other weekday finished green, and Tuesday was best at $157.12.", headline: "Monday -$57.32", caption: "Tuesday was best at +$157.12.", takeaway: "Compare each weekday on its own.", clip: { start: 5.2, end: 17.8 } },
      { narration: "One sample account, demo data. Your weekdays will split differently.", headline: "One sample account", caption: "Your weekdays will split differently.", takeaway: "Check your own weekdays." },
      { narration: "Check your own Mondays.", headline: "Check your Mondays.", caption: "Find out at fillbookhq.com.", takeaway: "Look for your own red day." },
    ],
    captionBody: "Four weekdays green, Mondays red. Demo data from one sample account.",
    youtubeTitle: "Mondays Cost This Account Money: Results by Day of Week",
  }),
  angleOf(PILOT_8, {
    key: "c",
    title: "Is one weekday losing you money?",
    hook: "Is one weekday losing you money?",
    topic: "Splitting a week by session day to find the one that loses",
    scenes: [
      { narration: "Is one weekday losing you money?", headline: "One red weekday?", caption: "Split by session day.", takeaway: "Split the week before judging it.", clip: { start: 1.9, end: 5.4 } },
      { narration: "Split by session day: Thursday up $104.60, Friday up $122.08, and Monday the only red day at negative $57.32.", headline: "Only one red day", caption: "Monday: 5 trades, -$57.32.", takeaway: "The red day stands out once the week is split.", clip: { start: 5.2, end: 17.8 } },
      { narration: "This is demo data from a single sample account, not a pattern to assume.", headline: "A single sample account", caption: "Not a pattern to assume.", takeaway: "Find your own pattern, not this one." },
      { narration: "Split your week by day.", headline: "Split your week.", caption: "Find out at fillbookhq.com.", takeaway: "See which day costs you." },
    ],
    captionBody: "Split the week by session day and the losing day stands out. Demo data from one sample account.",
    youtubeTitle: "Is One Weekday Losing You Money? Results by Session Day",
  }),
  angleOf(PILOT_9, {
    key: "b",
    title: "$20.37 a day. How far is the payout?",
    hook: "$20.37 a day. How far is the payout?",
    topic: "Turning a daily average into the distance to payout",
    scenes: [
      { narration: "$20.37 a day. How far is the payout?", headline: "$20.37 a day", caption: "129 trading days to payout-ready.", takeaway: "A daily average becomes a timeline." },
      { narration: "The target is 13% done, with $2,612.92 to go. Minimum days are met at 19, and the best day is over the consistency cap.", headline: "13% of the target", caption: "$2,612.92 still to go.", takeaway: "Each payout requirement moves separately." },
      { narration: "A projection from demo data, not a forecast. Your firm's payout policy is the one that counts.", headline: "A projection, not a forecast", caption: "Your firm's payout policy counts.", takeaway: "Confirm the policy with your firm." },
      { narration: "Turn your daily average into a date.", headline: "Turn it into a date.", caption: "Track yours at fillbookhq.com.", takeaway: "Know how far the payout really is." },
    ],
    captionBody: "A daily average turned into distance from a payout. A projection from demo data, not a prediction.",
    youtubeTitle: "$20.37 a Day: How Far Is the Payout Really?",
  }),
  angleOf(PILOT_9, {
    key: "c",
    title: "Payout-ready isn't one check.",
    hook: "Payout-ready isn't one check.",
    topic: "Payout readiness is several requirements, each tracked on its own",
    scenes: [
      { narration: "Payout-ready isn't one check.", headline: "Not one check", caption: "129 trading days at $20.37 a day.", takeaway: "Readiness is a list, not a number." },
      { narration: "19 trading days logged meets the 10-day minimum. But the best day is 46% of profit, over the 40% cap.", headline: "Days met. Consistency isn't.", caption: "Best day: 46% of profit, cap 40%.", takeaway: "One unmet check holds the payout." },
      { narration: "Demo data and a projection. Check your firm's actual payout requirements.", headline: "Check your firm's list", caption: "Demo data and a projection.", takeaway: "The firm's list is the real list." },
      { narration: "Check every payout requirement, one by one.", headline: "Check them one by one.", caption: "Track yours at fillbookhq.com.", takeaway: "Clear each requirement on its own." },
    ],
    captionBody: "Payout readiness is several checks, and one unmet check holds the payout. A projection from demo data.",
    youtubeTitle: "Payout-Ready Isn't One Check: Tracking Each Requirement",
  }),
];

export const PILOTS: ScenePlan[] = [PILOT_1, PILOT_2, PILOT_3, PILOT_4, PILOT_5, PILOT_6, PILOT_7, PILOT_8, PILOT_9, ...BATCH_3_PLANS, ...PILOT_ANGLES];

export function pilotMetadata(plan: ScenePlan, platform: Platform): PublishedVideoMetadata {
  const copy = PILOT_COPY[plan.planId] ?? ANGLE_COPY[plan.planId];
  if (!copy) throw new Error(`No metadata copy for ${plan.planId}`);
  return buildPublishedMetadata(plan, platform, {
    title: platform === "youtube_shorts" ? copy.youtubeTitle : plan.title,
    captionBody: copy.captionBody,
    hashtags: platform === "tiktok" ? TIKTOK_TAGS : YOUTUBE_TAGS,
    topic: copy.topic,
    cta: copy.cta,
  });
}
