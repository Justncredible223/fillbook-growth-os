import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene } from "./types.js";

/**
 * Real Fillbook app screenshots (phone width, 900-1300px) used as the
 * background of "product" scenes in place of a flat tinted card. All come
 * from the seeded demo account -- example data, not a real user's trades
 * -- which is why product scenes carry an on-screen "EXAMPLE DATA" label
 * (see scenes.ts's labelForScene), matching the script prompt's rule that
 * on-screen trading data is always labeled example/demo data. Phone status
 * bars/nav bars are cropped out and screenshots showing an account email
 * are deliberately not bundled.
 */
export interface UiScreen {
  file: string;
  /**
   * A controlled-vocabulary tag for what this screen actually shows (the same style of tag
   * verified-manifest.json uses for the nine claim-gated pilots, e.g. "drawdown", "edge_score") --
   * used only for the regression test/audit below, not for matching a shot to a screen (this path
   * has no per-scene declared topic to match against; see the module doc comment's "BIGGER GAP").
   */
  topic: string;
  /**
   * Lowercase phrases in a shot description that make this screen the natural match. Deliberately
   * NOT single generic trading words ("profit," "rules," "review," "best," "market," ...) that a
   * custom topic about almost anything could contain -- each phrase here must be reasonably
   * DISTINCTIVE of this specific screen, or a loosely related custom topic pulls in a screenshot
   * that doesn't actually support what it's saying (2026-09-27 audit; see the module doc comment).
   */
  keywords: string[];
}

const UI_SCREENS_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets", "ui");

/**
 * Order matters: a shot description picks the FIRST unused screen with a
 * matching keyword, so specific screens come before generic ones.
 *
 * Screens captured 2026-09-19 (phone width, 430px @ high DPR) all come from
 * the same demo-account state, so the figures agree across them (drawdown
 * buffer $690.50, health 68/100, EMA Pullback +1.57R, the Sep 16 revenge
 * sequence). Two older gallery screens (leaks-edge, daily-brief) were retired
 * because they showed different numbers for the same things (Biggest Leak
 * -$7,301 vs -$7,571; health 81/100 and a $2,000 buffer vs 68/100 and $690.50)
 * -- a viewer seeing both in one video would see the app contradict itself.
 * The remaining older screens (calendar, charts, weekly-review, edge-score,
 * top-markets, connect-source) were captured earlier from the same account
 * and show earlier-month data; treat their totals as illustrative.
 *
 * "trade-log-revenge.jpg" (manifest id ui.trade-log-flags.v1) was retired
 * 2026-09-27 for the same reason as leaks-edge/daily-brief below, but on
 * framing grounds rather than a factual contradiction: it tags one trade
 * "Revenge trade" and "Oversized," the exact motive-diagnosis framing
 * PILOT_3's 2026-09-23 rework (src/shortform/pilots.ts) deliberately
 * dropped in favor of a plan-relative size fact. Its old keyword entry here
 * ("revenge", "oversiz", "tilt", "sizing", "trade log", "trades", ...) meant
 * ANY custom/other topic whose shot description used one of those ordinary
 * words -- not just ones actually about this screen's flagged trade --
 * would still surface it, silently reintroducing that framing on a path
 * this whole system otherwise has no claim/evidence gate for (see the
 * bigger note below). Confirmed nothing else in the repo references this
 * file or its manifest asset before removing the entry; the asset/image
 * file itself is left in place in case it is needed again later, deliberately.
 *
 * 2026-09-27 CONTAINED FIX: the surviving screens' own keyword lists carried the identical risk
 * class as the retired trade-log-revenge.jpg -- generic single trading words ("risk," "account,"
 * "profit," "rules," "review," "best," "market," "score," "limit," ...) that almost any custom
 * topic could plausibly contain, regardless of whether that topic is actually about the specific
 * feature the screen shows. Every entry below was re-audited and tightened to phrases genuinely
 * DISTINCTIVE of that one screen (a named feature, e.g. "drawdown buffer," "edge score," "ai
 * coach," not a word any trading video would use). See uiScreens.test.ts's "a generic custom
 * topic that merely mentions ordinary trading words" regression test.
 *
 * BIGGER GAP, still not fixed here: this narrows the false-positive rate of the existing
 * free-text matching, but the underlying architecture is still keyword-similarity against
 * free-text `shot`, not the claim-to-fact gating claims.ts does for the nine verified pilots (no
 * per-fact evidence citation exists on this path, and Scene carries no structured topic to check
 * against a screen's own `topic` tag -- see the `topic` field's own doc comment). A screen tightened
 * this way can still be picked for a topic that happens to use one of its distinctive phrases in an
 * unrelated sense; only real per-claim evidence citation (like claims.ts) fully closes that.
 */
export const UI_SCREENS: UiScreen[] = [
  { file: "connect-source.jpg", topic: "broker_sync", keywords: ["importing trades", "connect your broker", "broker sync", "csv import"] },
  { file: "calendar.jpg", topic: "calendar", keywords: ["calendar", "trading calendar"] },
  {
    file: "intelligence-overview.jpg",
    topic: "intelligence",
    keywords: ["biggest leak", "strongest edge", "fillbook intelligence"],
  },
  {
    file: "drawdown-bars.jpg",
    topic: "drawdown",
    keywords: ["drawdown buffer", "trailing drawdown", "daily loss limit", "drawdown bar"],
  },
  { file: "ai-coach.jpg", topic: "ai_coach", keywords: ["ai coach", "ask fillbook", "what is dragging", "what's dragging"] },
  { file: "ai-coach-prompts.jpg", topic: "ai_coach_prompts", keywords: ["ask anything", "suggested questions"] },
  { file: "charts.jpg", topic: "equity_curve", keywords: ["equity curve", "p&l chart", "pnl chart"] },
  { file: "weekly-review.jpg", topic: "weekly_review", keywords: ["weekly review", "week in review"] },
  { file: "edge-score.jpg", topic: "edge_score", keywords: ["edge score", "discipline streak"] },
  { file: "top-markets.jpg", topic: "top_markets", keywords: ["top markets", "best markets", "strongest markets", "market breakdown"] },
];

/**
 * Picks a screen for each product scene: the first not-yet-used screen
 * whose keywords appear in the scene's shot description, otherwise the
 * next unused one in a seed-rotated order (so untagged shots still vary
 * between renders). Once every screen has been used it starts reusing them.
 * Only sets `imagePath` (an absolute path in the bundled assets dir); the
 * caller copies it into the render's output directory.
 */
export function assignUiScreens(scenes: Scene[], seed: number): void {
  const used = new Set<string>();
  for (const [i, scene] of scenes.entries()) {
    if (scene.kind !== "product") continue;
    const text = (scene.shot ?? "").toLowerCase();
    const available = UI_SCREENS.filter((s) => !used.has(s.file));
    const pool = available.length > 0 ? available : UI_SCREENS;
    const byKeyword = pool.find((s) => s.keywords.some((k) => text.includes(k)));
    const chosen = byKeyword ?? pool[(seed + i) % pool.length]!;
    used.add(chosen.file);
    scene.imagePath = join(UI_SCREENS_DIR, chosen.file);
  }
}

/**
 * Guarantees the hook scene is never a flat, motionless color card. Real published videos'
 * own TikTok retention data (checked 2026-09-21) showed viewers dropping off at 0:01 on every
 * video regardless of length or topic -- traced to the hook scene (always scene index 0, see
 * scenes.ts's classifyShot) being the one scene kind that `assignUiScreens` above never gives a
 * screenshot to, combined with stock footage (the intended primary hook treatment -- see
 * render.ts's dedicated hook zoom/scrim effect) silently failing whenever no API key is
 * configured or no relevant clip is found, per stockFootage.ts's fetchStockClip: "no clip is
 * strictly better than an off-topic clip." Both of those are reasonable choices on their own, but
 * together they left the hook scene with NO required fallback, so it fell all the way through to
 * `render.ts`'s solid-color lavfi source -- a static screen for the one second that decides
 * whether a viewer stays.
 *
 * This must run AFTER both assignUiScreens and the stock-footage fetch attempt, and only touches
 * a hook scene that still has neither `imagePath` nor `clipPath` at that point -- it never
 * overrides real stock footage or steals a screen a product scene already used this render.
 */
export function assignHookFallbackScreen(scenes: Scene[], seed: number): void {
  const used = new Set(scenes.map((s) => s.imagePath?.split(/[\\/]/).pop()).filter((f): f is string => Boolean(f)));
  for (const [i, scene] of scenes.entries()) {
    if (scene.kind !== "hook" || scene.imagePath || scene.clipPath) continue;
    const available = UI_SCREENS.filter((s) => !used.has(s.file));
    const pool = available.length > 0 ? available : UI_SCREENS;
    const chosen = pool[(seed + i) % pool.length]!;
    used.add(chosen.file);
    scene.imagePath = join(UI_SCREENS_DIR, chosen.file);
  }
}

/** Stable numeric seed from any id string (the local CLI's draft ids aren't necessarily UUIDs). */
export function seedFromId(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/** Copies a scene's screenshot next to the other render inputs (ffmpeg references files by basename only) and returns the new path. */
export function copyUiScreenToDir(imagePath: string, outDir: string): string {
  if (!existsSync(imagePath)) throw new Error(`UI screenshot missing: ${imagePath}`);
  const dest = join(outDir, `ui-${imagePath.split(/[\\/]/).pop()}`);
  copyFileSync(imagePath, dest);
  return dest;
}
