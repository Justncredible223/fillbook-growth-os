/**
 * The Fillbook views a public reply may show someone, each tied to the trader problem it answers
 * (owner direction 2026-09-25: X replies read as conversation, not as "here is how Fillbook helps
 * with the exact problem you tweeted about"). Every "shows" line describes a real screen, verified
 * against the captured recordings in scripts/video-factory/assets/verified-manifest.json -- the same
 * screens the P1-P9 motion concepts in src/shortform/pilots.ts are built on. Add a view here only
 * after it has been checked against the live app the same way.
 */
export interface FillbookShowcaseView {
  id: string;
  /** Plain-language trader problems this view answers. */
  problems: string;
  /** What the screen actually shows, in words a reply can use. */
  shows: string;
}

export const FILLBOOK_SHOWCASE_VIEWS: readonly FillbookShowcaseView[] = [
  {
    id: "setup_breakdown",
    problems: "a green month or account that hides a losing setup; not knowing which setup makes or loses the money; 'my strategy works but I'm still down'",
    shows: "the By setup breakdown: every setup on its own row with its trade count, win rate and net P&L, worst first",
  },
  {
    id: "account_buffer",
    problems: "confusing account balance with drawdown room; a trailing drawdown surprise; not knowing how much room is left today",
    shows: "each prop account's trailing drawdown buffer in dollars, today's loss limit remaining, and profit target progress, side by side",
  },
  {
    id: "size_vs_plan",
    problems: "sizing up after losses or on a hunch; breaking a max-contracts rule; 'same setup, bigger size'",
    shows: "the trading plan's max contracts per trade, next to a trade log that shows each trade's size and setup, so a 5-lot on a 3-contract plan is right there",
  },
  {
    id: "consistency_cap",
    problems: "a consistency rule blocking or delaying a payout; one big day making up too much of the profit",
    shows: "account health flagging, as its most important action, when one day's share of total profit is over the firm's consistency cap (for example 46% against a 40% cap)",
  },
  {
    id: "rule_simulator",
    problems: "wondering whether they'd pass a firm's evaluation; choosing between prop firms; confusion about a firm's rules",
    shows: "the rule simulator: it replays the trades they already logged against a firm's evaluation rules, including a firm they haven't signed up with, with a checklist for profit target, minimum days, drawdown, daily loss and consistency",
  },
  {
    id: "edge_score",
    problems: "not knowing whether they're actually improving; wanting one honest read on their trading beyond P&L",
    shows: "the Edge Score: one number blending profitability, consistency, risk control, and stop and rule adherence, with each part broken out and a trend over recent weeks",
  },
  {
    id: "daily_brief",
    problems: "starting the day without reviewing yesterday; trading outside their best hours; forgetting how much room is left before the session",
    shows: "the Daily Brief before the session: last session's result, the buffer left to the drawdown floor and today's loss limit, and their strongest time window with its win rate",
  },
  {
    id: "day_of_week",
    problems: "one day of the week that keeps costing them; 'I always lose on Mondays/Fridays'",
    shows: "P&L and trade count by day of week, using the session date, so the one red weekday stands out",
  },
  {
    id: "payout_timeline",
    problems: "wondering how long until a payout; payout requirements they can't keep track of",
    shows: "the payout timeline: trading days to payout-ready at their current pace, a what-if for a different daily average, and a readiness checklist of the firm's payout requirements",
  },
];

export const SHOWCASE_NONE = "none";

/** The ids a reply's `showcase` field may take. */
export const SHOWCASE_IDS: readonly string[] = [...FILLBOOK_SHOWCASE_VIEWS.map((view) => view.id), SHOWCASE_NONE];

/** The views as a prompt block. */
export function formatShowcaseViews(): string {
  return FILLBOOK_SHOWCASE_VIEWS.map((view) => `- ${view.id}: for ${view.problems}. Fillbook shows ${view.shows}.`).join("\n");
}

/**
 * How a reply shows Fillbook, shared by cold (Prospecting) and inbound replies on X. Replaces the
 * "mention it almost as an aside, and only when earned" guidance, which produced replies that read
 * as friendly conversation with no reason to try the product.
 */
export const SHOWCASE_REPLY_GUIDANCE = `YOUR JOB IN THIS REPLY: when their post describes a problem Fillbook answers, show them what Fillbook would
show them about that exact problem. The goal is a reader thinking "I want to see that for my own trades."

The Fillbook views you may show (the ONLY product capabilities you may describe):
${formatShowcaseViews()}

When one of these views fits their problem:
1. First, one specific, useful point about their situation: the rule, the number, or what is likely going on.
   Plain and short.
2. Then one sentence that names Fillbook and describes concretely what that view would show them, in the terms
   of their post. "Fillbook's By setup view would put that ORB on its own row with its own win rate and net P&L,
   so a green month can't hide it" is the shape. "We track that in Fillbook" is too vague to make anyone curious.
3. The Fillbook sentence is the point of the reply, not an aside. Pick exactly ONE view. Describe what it shows;
   never promise what it will do for them, and never invent numbers about their account.

Worked examples (write your own for the actual post, never copy these):
Their post: "Up on the month but some of my trades just keep bleeding and I can't tell which."
Reply: "Usually it's one setup eating what the others make. Fillbook splits every trade by setup with its own win
rate and net P&L, so the one that's bleeding sits at the top of the list."
Their post: "Passed my eval, requested a payout, got denied for the consistency rule. Nobody warned me."
Reply: "That rule usually measures your best day's share of total profit, so one big day late in the eval does it.
Fillbook's account health puts that share next to your firm's cap before you ever hit request."

When NO view fits (a market call, news, a meme, a pure price question, small talk), just answer or react well and
leave Fillbook out. Forcing a view onto a post it doesn't fit reads as spam and costs trust.

Hard rules, no exceptions:
- No link unless the link policy below allows it, and no call to action: never "check it out", "try it", "sign up",
  "learn more", "DM me", "click here", "link in bio", discount talk or urgency. Showing the view is the pitch.
- Never claim a personal trading result, a customer or user result, or a capability that is not in the list above
  or the verified knowledge given to you.
- Never impersonate an individual trader or conceal that this is the Fillbook account replying. The voice sounds
  like a real person, but the affiliation is never hidden or denied.`;
