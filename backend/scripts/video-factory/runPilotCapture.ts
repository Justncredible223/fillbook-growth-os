#!/usr/bin/env node
/**
 * Captures the three pilots' product footage at phone resolution (432x768 CSS at 2.5x = 1080x1920) from a LOCAL
 * Fillbook dev server + local Supabase stack seeded by fillbook/frontend/scripts/seed-pilot-fixtures.mjs.
 *
 *   FILLBOOK_BASE_URL=http://localhost:5173 PILOT_STORAGE_STATE=<saved signed-in state.json> \
 *   npx tsx scripts/video-factory/runPilotCapture.ts [pilot-1|pilot-2|pilot-3|all]
 *
 * or PILOT_EMAIL + PILOT_PASSWORD instead of PILOT_STORAGE_STATE to sign in (desktop layout, not filmed) first.
 * Writes <id>.mp4 plus <id>.timeline.json (step times, cuts, taps, measured element boxes in device pixels).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { runStepCapture, type Step, type StepCaptureSpec } from "./stepCapture.js";

const BASE_URL = process.env.FILLBOOK_BASE_URL || "http://localhost:5173";
const OUT_DIR = join(process.cwd(), "..", "out", "motion-capture-mobile");
const VIEWPORT = { width: 432, height: 768 };
const DPR = 2.5;

const TRADE_ORB_5 = "text=5 × 20000.00";

const SHOTS: Record<string, { id: string; steps: Step[] }> = {
  "pilot-1": {
    id: "p1-mobile-reports-setup-breakdown",
    steps: [
      { kind: "goto", route: "/reports", waitFor: "text=$387.08" },
      { kind: "scroll", selector: "text=Profit factor", seconds: 0.034 },
      { kind: "measure", name: "net_pnl_label", selector: "text=Net P&L" },
      { kind: "measure", name: "total_fees_label", selector: "text=Total fees" },
      { kind: "hold", seconds: 4.5 },
      { kind: "scroll", selector: "text=Free-text setup field", seconds: 1.2 },
      { kind: "measure", name: "by_setup_subtitle", selector: "text=Free-text setup field" },
      { kind: "measure", name: "orb_row", selector: "text=Opening Range Break" },
      { kind: "hold", seconds: 12 },
    ],
  },
  "pilot-2": {
    id: "p2-mobile-dashboard-to-rules",
    steps: [
      { kind: "goto", route: "/dashboard", waitFor: "text=22 trades logged" },
      { kind: "scroll", selector: "text=22 trades logged", seconds: 0.034 },
      { kind: "measure", name: "net_line", selector: "text=22 trades logged" },
      { kind: "measure", name: "net_pnl_label", selector: "text=Net P&L" },
      { kind: "hold", seconds: 4.2 },
      { kind: "goto", route: "/rules", waitFor: "text=Pilot Fixture 50K Evaluation" },
      { kind: "measure", name: "card_title", selector: "text=Pilot Fixture 50K Evaluation" },
      { kind: "measure", name: "profit_target", selector: "text=Profit target" },
      { kind: "hold", seconds: 12 },
    ],
  },
  "pilot-3": {
    id: "p3-mobile-trade-size-vs-plan",
    steps: [
      { kind: "goto", route: "/trades", waitFor: TRADE_ORB_5 },
      { kind: "hold", seconds: 0.6 },
      { kind: "scroll", selector: TRADE_ORB_5, seconds: 1.2 },
      { kind: "measure", name: "orb5_line", selector: TRADE_ORB_5 },
      { kind: "hold", seconds: 8.5 },
      { kind: "goto", route: "/plan", waitFor: "text=Max contracts per trade" },
      { kind: "hold", seconds: 0.6 },
      { kind: "scroll", selector: "text=Max contracts per trade", seconds: 1.2 },
      { kind: "measure", name: "max_contracts_label", selector: "text=Max contracts per trade" },
      { kind: "hold", seconds: 8.5 },
    ],
  },
  "pilot-4": {
    id: "p4-mobile-account-health-consistency",
    steps: [
      { kind: "goto", route: "/dashboard", waitFor: "text=22 trades logged" },
      { kind: "hold", seconds: 0.5 },
      { kind: "scroll", selector: "text=Account health", seconds: 1.2, block: "start", offsetCss: 100 },
      { kind: "measure", name: "health_heading", selector: "text=Account health" },
      { kind: "hold", seconds: 4.5 },
      { kind: "scroll", selector: "text=Most important action", seconds: 1.0, block: "center" },
      { kind: "measure", name: "action_heading", selector: "text=Most important action" },
      { kind: "hold", seconds: 12 },
    ],
  },
  "pilot-5": {
    id: "p5-mobile-rule-simulator",
    steps: [
      { kind: "goto", route: "/simulate", waitFor: "text=No active breach" },
      { kind: "hold", seconds: 4.5 },
      { kind: "scroll", selector: "text=No active breach", seconds: 1.2, block: "start", offsetCss: 100 },
      { kind: "measure", name: "result_heading", selector: "text=No active breach" },
      { kind: "hold", seconds: 12 },
    ],
  },
  "pilot-6": {
    id: "p6-mobile-edge-score",
    steps: [
      { kind: "goto", route: "/dashboard", waitFor: "text=22 trades logged" },
      { kind: "hold", seconds: 0.5 },
      { kind: "scroll", selector: "text=Edge Score", seconds: 1.4, block: "start", offsetCss: 100 },
      { kind: "measure", name: "edge_heading", selector: "text=Edge Score" },
      { kind: "hold", seconds: 4.5 },
      { kind: "scroll", selector: "text=Edge map", seconds: 1.0, block: "start", offsetCss: 100 },
      { kind: "measure", name: "edge_map_heading", selector: "text=Edge map" },
      { kind: "hold", seconds: 12 },
    ],
  },
  "pilot-7": {
    id: "p7-mobile-daily-brief",
    steps: [
      { kind: "goto", route: "/dashboard", waitFor: "text=22 trades logged" },
      { kind: "hold", seconds: 0.5 },
      { kind: "scroll", selector: "text=Daily Brief", seconds: 1.2, block: "start", offsetCss: 100 },
      { kind: "measure", name: "brief_heading", selector: "text=Daily Brief" },
      { kind: "hold", seconds: 16 },
    ],
  },
  "pilot-8": {
    id: "p8-mobile-day-of-week",
    steps: [
      { kind: "goto", route: "/reports", waitFor: "text=$387.08" },
      { kind: "hold", seconds: 0.5 },
      { kind: "scroll", selector: "text=By day of week", seconds: 1.4, block: "start", offsetCss: 100 },
      { kind: "measure", name: "dow_heading", selector: "text=By day of week" },
      { kind: "hold", seconds: 16 },
    ],
  },
  "pilot-9": {
    id: "p9-mobile-payout-timeline",
    steps: [
      { kind: "goto", route: "/payouts", waitFor: "text=payout timeline" },
      { kind: "hold", seconds: 0.5 },
      { kind: "scroll", selector: "text=payout timeline", seconds: 1.2, block: "start", offsetCss: 100 },
      { kind: "measure", name: "timeline_heading", selector: "text=payout timeline" },
      { kind: "hold", seconds: 4.5 },
      { kind: "scroll", selector: "text=payout readiness", seconds: 1.0, block: "start", offsetCss: 100 },
      { kind: "measure", name: "readiness_heading", selector: "text=payout readiness" },
      { kind: "hold", seconds: 12 },
    ],
  },
};

async function signIn(statePath: string): Promise<void> {
  const email = process.env.PILOT_EMAIL;
  const password = process.env.PILOT_PASSWORD;
  if (!email || !password) throw new Error("Set PILOT_STORAGE_STATE, or PILOT_EMAIL + PILOT_PASSWORD for the seeded throwaway local account.");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE_URL);
  await page.getByRole("link", { name: /^Sign In$/i }).or(page.getByRole("button", { name: /^Sign In$/i })).first().click();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForTimeout(3000);
  await page.getByText("Main account").first().click();
  await page.waitForTimeout(500);
  await page.getByText("Pilot Fixture Account", { exact: true }).click();
  await page.waitForTimeout(1500);
  await ctx.storageState({ path: statePath });
  await browser.close();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let statePath = process.env.PILOT_STORAGE_STATE;
  if (!statePath) {
    statePath = join(OUT_DIR, "signed-in-state.json");
    await signIn(statePath);
  }
  const arg = process.argv[2] || "all";
  const keys = arg === "all" ? Object.keys(SHOTS) : [arg];
  for (const key of keys) {
    const shot = SHOTS[key];
    if (!shot) throw new Error(`Unknown pilot "${key}". Known: ${Object.keys(SHOTS).join(", ")}, all`);
    const spec: StepCaptureSpec = { id: shot.id, baseUrl: BASE_URL, viewportCss: VIEWPORT, deviceScaleFactor: DPR, storageStatePath: statePath, steps: shot.steps };
    console.log(`\n=== ${key}: ${shot.id} ===`);
    const result = await runStepCapture(spec, OUT_DIR);
    writeFileSync(join(OUT_DIR, `${shot.id}.timeline.json`), JSON.stringify(result, null, 2));
    console.log(`${result.outputPath} (${result.durationSeconds}s) cuts=${JSON.stringify(result.cutsAtSeconds)} holdsUnchanged=${result.holdChecks.map((h) => h.unchanged).join(",")}`);
    for (const e of result.timeline) console.log(`  ${e.startSeconds.toFixed(2)}-${e.endSeconds.toFixed(2)} ${e.kind} ${e.detail ?? ""}`);
    console.log(`  measurements: ${JSON.stringify(result.measurements)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
