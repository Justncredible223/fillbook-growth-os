import { buildPublishedMetadata, type PublishedVideoMetadata } from "./metadata.js";
import { OFFICIAL_HANDLE, type Claim, type Platform, type Rect, type SceneSpec, type ScenePlan } from "./types.js";

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
const EXAMPLE = "EXAMPLE DATA";

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
    masks: [],
  };
}

/* ---------------------------------------------------------------------------------------------- */
/* Pilot 1: "Green month. Losing setup."   Series: What the Total Hides                            */
/* ---------------------------------------------------------------------------------------------- */

const P1 = "p1-a";
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
      assetId: "ui.month-overview-setups.v1",
      crop: { x: 40, y: 480, w: 480, h: 170 },
      focal: { x: 40, y: 480, w: 480, h: 170 },
      headline: "Green month. Losing setup.",
      caption: "The total is positive.",
      seconds: 2.6, // real edge-tts speech is 2.0s; was 3.0s authored-guess
      disclosure: EXAMPLE,
      topics: ["month_total"],
      claims: [{ id: "p1-c1", type: "data_point", text: "The example month total is positive.", evidence: [{ assetId: "ui.month-overview-setups.v1", factKey: "month.total_positive" }] }],
    }),
    scene({
      sceneId: "p1-s2-trades",
      variationId: P1,
      narration: "The month is positive, and the trade count is right there on screen.",
      takeaway: "The total is built from many trades, not one.",
      assetId: "ui.month-overview-setups.v1",
      crop: { x: 530, y: 650, w: 470, h: 170 },
      focal: { x: 530, y: 650, w: 470, h: 170 },
      headline: "Positive month",
      caption: "Every trade counts toward the total.",
      seconds: 4.1, // real edge-tts speech is 3.5s; was 5.0s authored-guess
      disclosure: EXAMPLE,
      topics: ["month_total"],
      claims: [{ id: "p1-c2", type: "data_point", text: "The month view shows the number of trades behind the total.", evidence: [{ assetId: "ui.month-overview-setups.v1", factKey: "month.trade_count" }] }],
    }),
    /**
     * The real "By setup" row has its label flush left and its trade count/result flush right,
     * ~940px apart in the 1444px-wide source screenshot. One crop cannot include both and stay
     * phone-readable (a crop wide enough for both is width-limited to ~0.62x, per fitCrop), so this
     * beat is split in two: the setup name, then its trade count and dollar result.
     */
    scene({
      sceneId: "p1-s3-setups",
      variationId: P1,
      narration: "Break it down by setup. One stands out.",
      takeaway: "Break a total down by setup to find the one that is not working.",
      assetId: "ui.setup-breakdown.v1",
      crop: { x: 0, y: 220, w: 380, h: 120 },
      focal: { x: 0, y: 270, w: 230, h: 40 },
      headline: "One setup stands out",
      caption: "Opening Range Break: the worst setup this month.",
      seconds: 2.8, // real edge-tts speech is 2.5s exactly; was 2.5s authored-guess, leaving no margin
      disclosure: EXAMPLE,
      topics: ["setup_breakdown"],
      claims: [{ id: "p1-c3", type: "data_point", text: "The setup breakdown highlights Opening Range Break as the worst setup this month.", evidence: [{ assetId: "ui.setup-breakdown.v1", factKey: "setup.losing_setup_name" }] }],
    }),
    scene({
      sceneId: "p1-s3-setups-result",
      variationId: P1,
      narration: "It shows 2 trades, 0% win, and -$1,030.00.",
      takeaway: "Break a total down by setup to find the one that is not working.",
      assetId: "ui.setup-breakdown.v1",
      crop: { x: 1064, y: 220, w: 380, h: 120 },
      focal: { x: 1140, y: 270, w: 280, h: 40 },
      headline: "0% win. -$1,030.00.",
      caption: "The total hides it. The breakdown shows it.",
      seconds: 6.6, // real edge-tts speech is 6.0s (spoken dollar figures run long); was 3.5s authored-guess, which cut the line off
      disclosure: EXAMPLE,
      topics: ["setup_breakdown"],
      claims: [{ id: "p1-c3b", type: "data_point", text: "Opening Range Break shows 2 trades, 0% win, and a -$1,030.00 result.", evidence: [{ assetId: "ui.setup-breakdown.v1", factKey: "setup.losing_setup_result" }] }],
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

const P2 = "p2-a";
const DD = "ui.drawdown-bars.v1";
/**
 * Crops are in the 1290x872 source. The app header (y < 175) is always excluded.
 *
 * The full "Funded 50K" card (DD_CARD, retired below) put four unrelated numbers in every frame
 * at a width-limited ~0.74x scale, so each of the buffer/profit callouts read small next to the
 * giant single-metric shots elsewhere in this pilot. DD_BUFFER_ONLY and DD_PROFIT_ONLY isolate one
 * label/value pair each; DD_BUFFER_AND_PROFIT keeps both metrics the "compare" scene needs while
 * still dropping the account-name header above them.
 */
const DD_BUFFER: Rect = { x: 60, y: 335, w: 1170, h: 230 };
const DD_LOSS: Rect = { x: 60, y: 575, w: 1170, h: 175 };
const DD_BUFFER_ONLY: Rect = { x: 88, y: 340, w: 1120, h: 215 };
const DD_PROFIT_ONLY: Rect = { x: 85, y: 730, w: 830, h: 120 };
const DD_BUFFER_AND_PROFIT: Rect = { x: 85, y: 340, w: 1120, h: 465 };

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
      assetId: DD,
      crop: DD_BUFFER_ONLY,
      headline: "Balance isn't your buffer.",
      caption: "Profit and buffer answer different questions.",
      seconds: 2.0, // real edge-tts speech is 1.4s; was 3.0s authored-guess
      disclosure: EXAMPLE,
      topics: ["profit_target", "buffer"],
      claims: [
        {
          id: "p2-c1",
          type: "product_capability",
          text: "The account card shows the trailing drawdown buffer as its own tracked number, separate from balance.",
          evidence: [{ assetId: DD, factKey: "rule.trailing_drawdown_buffer" }],
        },
      ],
    }),
    scene({
      sceneId: "p2-s2-profit",
      variationId: P2,
      narration: "This example account shows $12,967.14 in profit against a $3,000.00 target.",
      takeaway: "Profit can be far past the target.",
      assetId: DD,
      crop: DD_PROFIT_ONLY,
      focal: { x: 95, y: 748, w: 810, h: 52 },
      headline: "Far past the target",
      caption: "Profit target: $3,000.00. Currently $12,967.14.",
      seconds: 8.4, // real edge-tts speech is 7.8s (spoken dollar figures run long); was 5.5s authored-guess, which cut the line off
      disclosure: EXAMPLE,
      topics: ["profit_target"],
      claims: [{ id: "p2-c2", type: "data_point", text: "Profit target $3,000.00, currently $12,967.14.", evidence: [{ assetId: DD, factKey: "account.profit_target_progress" }] }],
    }),
    scene({
      sceneId: "p2-s3-buffer",
      variationId: P2,
      narration: "The trailing drawdown buffer reads $690.50.",
      takeaway: "The buffer is a separate, much smaller number.",
      assetId: DD,
      crop: DD_BUFFER,
      headline: "Buffer: $690.50",
      caption: "This is the trailing drawdown buffer.",
      seconds: 5.1, // real edge-tts speech is 4.5s (spoken dollar figure runs long); was 4.0s authored-guess, which cut the line off
      disclosure: EXAMPLE,
      topics: ["drawdown", "buffer"],
      claims: [{ id: "p2-c3", type: "data_point", text: "Trailing drawdown buffer $690.50.", evidence: [{ assetId: DD, factKey: "rule.trailing_drawdown_buffer" }] }],
    }),
    scene({
      sceneId: "p2-s4-loss-limit",
      variationId: P2,
      narration: "Today's loss limit remaining reads $1,200.00.",
      takeaway: "A daily limit is another separate number to read.",
      assetId: DD,
      crop: DD_LOSS,
      headline: "Daily limit: $1,200.00",
      caption: "Today's loss limit remaining.",
      seconds: 4,
      disclosure: EXAMPLE,
      topics: ["buffer"],
      claims: [{ id: "p2-c4", type: "data_point", text: "Today's loss limit remaining $1,200.00.", evidence: [{ assetId: DD, factKey: "rule.daily_loss_limit_remaining" }] }],
    }),
    scene({
      sceneId: "p2-s5-compare",
      variationId: P2,
      narration: "Profit is one number. The buffer is another. Fillbook shows both from the rules you configure.",
      takeaway: "Read the buffer next to the balance, not instead of it.",
      assetId: DD,
      crop: DD_BUFFER_AND_PROFIT,
      headline: "Read both",
      caption: "Profit and buffer, side by side.",
      seconds: 6.1, // real edge-tts speech is 5.5s; was 6.5s authored-guess
      disclosure: EXAMPLE,
      topics: ["profit_target", "buffer"],
      claims: [
        {
          id: "p2-c5",
          type: "product_capability",
          text: "Fillbook shows profit progress and the drawdown buffer for a configured account.",
          evidence: [
            { assetId: DD, factKey: "account.profit_target_progress" },
            { assetId: DD, factKey: "rule.trailing_drawdown_buffer" },
          ],
        },
      ],
    }),
    scene({
      sceneId: "p2-s6-qualify",
      variationId: P2,
      narration: "These numbers depend on the trades you record and the rules you configure. Check your prop firm's own rules for the official limits.",
      takeaway: "The figures are only as good as the trades recorded and the settings entered.",
      headline: "Based on recorded trades",
      caption: "Results depend on the trades you record and the rules you set.",
      seconds: 7.3, // real edge-tts speech is 6.7s; was 8.5s authored-guess
      disclosure: "Not a broker or risk system.",
      topics: ["buffer"],
      claims: [{ id: "p2-c6", type: "concept", text: "Qualifies that results depend on recorded trades and correct settings.", evidence: [] }],
    }),
    scene({
      sceneId: "p2-s7-close",
      variationId: P2,
      narration: "Follow for more rule reads.",
      takeaway: "Read the rule before you trust the balance.",
      headline: "Read the rule.",
      caption: "Check your buffer, not just your balance.",
      seconds: 2.5, // real edge-tts speech is 1.9s; was 3.0s authored-guess
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["buffer"],
      claims: [{ id: "p2-c7", type: "invitation", text: "Invites the viewer to follow for more rule explainers.", evidence: [] }],
    }),
  ],
};

/* ---------------------------------------------------------------------------------------------- */
/* Pilot 3: "Same setup. Bigger size."   Series: One Trade to Review                               */
/* ---------------------------------------------------------------------------------------------- */

const P3 = "p3-a";
const TL = "ui.trade-log-flags.v1";
/** Excludes the row checkbox (~x48-140) and the Details/edit/delete icon row (y >= 1070) that the original full-card crop included; keeps symbol/side/result, date/qty/price, setup name, and both tags. */
const TL_FLAGGED: Rect = { x: 195, y: 696, w: 630, h: 350 };

export const PILOT_3: ScenePlan = {
  planId: "pilot-3-same-setup-bigger-size",
  title: "Same setup. Bigger size.",
  series: "One Trade to Review",
  topic: "A trade flagged Oversized is a prompt to review the sequence, not proof of intent",
  hook: "Same setup. Bigger size.",
  experimentId: PILOT_EXPERIMENT_ID,
  variationId: P3,
  platforms: ["tiktok", "youtube_shorts"],
  voice: VOICE,
  visualStyle: VISUAL_STYLE,
  requiredAssets: [],
  scenes: [
    scene({
      sceneId: "p3-s1-before",
      variationId: P3,
      first: true,
      narration: "Same setup. Bigger size.",
      takeaway: "Compare the earlier trade with the later one before drawing conclusions.",
      assetId: "ui.trade-log-before.v1",
      crop: { x: 0, y: 130, w: 1417, h: 123 },
      focal: { x: 0, y: 130, w: 1417, h: 123 },
      headline: "Same setup. Bigger size.",
      caption: "First, the earlier trade.",
      seconds: 2.6, // real edge-tts speech is 2.0s; was 3.0s authored-guess
      disclosure: EXAMPLE,
      topics: ["trade_size"],
      claims: [{ id: "p3-c1", type: "data_point", text: "An earlier trade of the same setup at a smaller size.", evidence: [{ assetId: "ui.trade-log-before.v1", factKey: "trade.same_setup_smaller_size" }] }],
    }),
    scene({
      sceneId: "p3-s2-flagged",
      variationId: P3,
      narration: "Later, the same setup shows 8 contracts. The trade log tagged it Revenge trade and Oversized.",
      takeaway: "The log tagged the trade; that is a prompt to look closer.",
      assetId: TL,
      crop: TL_FLAGGED,
      focal: { x: 205, y: 968, w: 485, h: 62 },
      headline: "Flagged for review",
      caption: "Tagged Revenge trade and Oversized.",
      seconds: 6.5,
      disclosure: EXAMPLE,
      topics: ["behavior_flags", "trade_size"],
      claims: [
        { id: "p3-c2", type: "data_point", text: "An 8 contract Opening Range Break trade.", evidence: [{ assetId: TL, factKey: "trade.orb_mnq_8x_flagged" }] },
        { id: "p3-c3", type: "behavior_flag", text: "The trade is tagged Revenge trade and Oversized.", evidence: [{ assetId: TL, factKey: "flag.revenge_and_oversized_tags" }] },
      ],
    }),
    scene({
      sceneId: "p3-s3-prompt",
      variationId: P3,
      narration: "A flag is a prompt to review the trade, not proof of why it happened.",
      takeaway: "A behavior flag is a review prompt, not a diagnosis.",
      headline: "A prompt, not a verdict",
      caption: "Review the sequence before you decide.",
      seconds: 4.5, // real edge-tts speech is 3.9s; was 5.0s authored-guess
      topics: ["behavior_flags"],
      claims: [{ id: "p3-c4", type: "concept", text: "Frames a behavior flag as a review prompt.", evidence: [] }],
    }),
    scene({
      sceneId: "p3-s4-close",
      variationId: P3,
      narration: "What would you look at first?",
      takeaway: "Pick one trade and review it end to end.",
      headline: "What do you look at first?",
      caption: "Pick one trade to review.",
      seconds: 2.5, // real edge-tts speech is 1.9s; was 3.5s authored-guess
      cta: `Follow ${OFFICIAL_HANDLE}`,
      topics: ["behavior_flags"],
      claims: [{ id: "p3-c5", type: "invitation", text: "Invites the viewer to review a trade.", evidence: [] }],
    }),
  ],
};

export const PILOTS: ScenePlan[] = [PILOT_1, PILOT_2, PILOT_3];

/* ---------------------------------------------------------------------------------------------- */
/* Platform metadata for each pilot (built now, saved only after the owner publishes by hand).     */
/* ---------------------------------------------------------------------------------------------- */

const TIKTOK_TAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingPsychology", "TradingDiscipline"];
const YOUTUBE_TAGS = ["FuturesTrading", "PropFirmTrading", "TradingJournal", "TradingDiscipline"];

const PILOT_COPY: Record<string, { topic: string; cta: string; captionBody: string; youtubeTitle: string }> = {
  [PILOT_1.planId]: {
    topic: PILOT_1.topic,
    cta: "Follow for more trade reviews",
    captionBody: "A positive month can still hide a setup that loses. This is an example month, so check your own breakdown by setup.",
    youtubeTitle: "Green Month, Losing Setup: Read Your Setup Breakdown",
  },
  [PILOT_2.planId]: {
    topic: PILOT_2.topic,
    cta: "Follow for more rule reads",
    captionBody: "Your balance and your buffer answer different questions. Example account, based on recorded trades and configured rules.",
    youtubeTitle: "Balance vs Drawdown Buffer: Read the Rule",
  },
  [PILOT_3.planId]: {
    topic: PILOT_3.topic,
    cta: "Follow for more trade reviews",
    captionBody: "A flagged trade is a prompt to review the sequence, not proof of why it happened. Example data.",
    youtubeTitle: "Same Setup, Bigger Size: Review the Trade Sequence",
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
