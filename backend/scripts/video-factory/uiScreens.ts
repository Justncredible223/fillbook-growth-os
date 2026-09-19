import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scene } from "./types.js";

/**
 * Real Fillbook app screenshots (phone width, 1080px) used as the
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

export const UI_SCREENS: UiScreen[] = [
  { file: "connect-source.jpg", keywords: ["import", "broker", "connect", "sync", "csv", "platform"] },
  { file: "calendar.jpg", keywords: ["calendar", "month", "day by day", "daily"] },
  { file: "charts.jpg", keywords: ["chart", "equity", "curve", "p&l", "pnl", "profit", "wins"] },
  { file: "weekly-review.jpg", keywords: ["review", "weekly", "week", "journal", "notes", "reflect"] },
  { file: "leaks-edge.jpg", keywords: ["leak", "mistake", "stop", "error", "repeat", "pattern", "trade log", "trades"] },
  { file: "edge-score.jpg", keywords: ["score", "edge", "streak", "discipline", "consistency", "rules"] },
  { file: "top-markets.jpg", keywords: ["market", "best", "setup", "top"] },
  { file: "daily-brief.jpg", keywords: ["brief", "drawdown", "risk", "buffer", "health", "limit", "account"] },
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
