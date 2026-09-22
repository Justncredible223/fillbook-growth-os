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
  /** Lowercase words in a shot description that make this screen the natural match. */
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
 */
export const UI_SCREENS: UiScreen[] = [
  { file: "connect-source.jpg", keywords: ["import", "broker", "connect", "sync", "csv", "platform"] },
  { file: "calendar.jpg", keywords: ["calendar", "month", "day by day", "daily"] },
  {
    file: "trade-log-revenge.jpg",
    keywords: ["revenge", "oversiz", "tilt", "mistake", "error", "repeat", "pattern", "trade log", "trades", "loss streak", "overtrad", "sizing"],
  },
  {
    file: "intelligence-overview.jpg",
    keywords: ["leak", "stop", "insight", "intelligence", "testing", "experiment", "learn", "biggest", "strongest", "adherence"],
  },
  {
    file: "drawdown-bars.jpg",
    keywords: ["drawdown", "buffer", "trailing", "loss limit", "daily loss", "funded", "prop", "floor", "risk", "payout", "limit", "account"],
  },
  { file: "ai-coach.jpg", keywords: ["ai coach", "coach", "ask fillbook", "win rate", "dragging"] },
  { file: "ai-coach-prompts.jpg", keywords: ["ask anything", "suggested", "questions", "prompt", "any language", "chatbot"] },
  { file: "charts.jpg", keywords: ["chart", "equity", "curve", "p&l", "pnl", "profit", "wins"] },
  { file: "weekly-review.jpg", keywords: ["review", "weekly", "week", "journal", "notes", "reflect"] },
  { file: "edge-score.jpg", keywords: ["score", "edge", "streak", "discipline", "consistency", "rules"] },
  { file: "top-markets.jpg", keywords: ["market", "best", "setup", "top"] },
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
