/**
 * Frame-stepped product capture at true phone resolution (e.g. 432x768 CSS at 2.5x = 1080x1920).
 *
 * Playwright's recordVideo and Chrome's screencast both emit CSS-pixel frames (432x768 here), so text would be
 * upscaled and soft. Instead every output frame is a real device-resolution screenshot of the live local app:
 * eased scrolls are rendered frame by frame at their actual scroll offsets, a hold is one screenshot whose
 * stillness is re-checked at the end of the hold, and the moments after a tap are screenshotted in real time.
 *
 * Read-only by construction: the vocabulary is goto / hold / scroll / tap / measure, and `tap` only accepts an
 * in-app link (a[href^="/"]) or a disclosure control (aria-expanded, <summary>, or a "Details"/"Hide details"
 * toggle). Local targets only.
 */
import { chromium, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createProcessRunner } from "./processRunner.js";

export type Step =
  | { kind: "goto"; route: string; waitFor: string }
  | { kind: "hold"; seconds: number }
  | { kind: "scroll"; selector: string; seconds: number; block?: "center" | "start"; offsetCss?: number }
  | { kind: "tap"; selector: string; settleSeconds: number }
  | { kind: "measure"; name: string; selector: string };

export interface StepCaptureSpec {
  id: string;
  baseUrl: string;
  viewportCss: { width: number; height: number };
  deviceScaleFactor: number;
  storageStatePath: string;
  steps: Step[];
}

export interface StepTimelineEntry {
  step: number;
  kind: Step["kind"];
  startSeconds: number;
  endSeconds: number;
  detail?: string;
}

export interface StepCaptureResult {
  outputPath: string;
  durationSeconds: number;
  timeline: StepTimelineEntry[];
  cutsAtSeconds: number[];
  taps: { atSeconds: number; x: number; y: number }[];
  measurements: Record<string, { atSeconds: number; x: number; y: number; w: number; h: number }>;
  holdChecks: { step: number; unchanged: boolean }[];
}

const FPS = 30;
const FRAME = 1 / FPS;

function assertLocal(baseUrl: string): void {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) throw new Error(`Refusing non-local capture target: ${baseUrl}`);
}

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

async function assertReadOnlyTapTarget(target: Locator, selector: string): Promise<void> {
  const ok = await target.evaluate((el) => {
    const link = el.closest("a[href]");
    if (link && (link.getAttribute("href") ?? "").startsWith("/")) return true;
    const ctl = el.closest("button, summary, [role=button]");
    if (!ctl) return false;
    if (ctl.tagName === "SUMMARY" || ctl.hasAttribute("aria-expanded")) return true;
    return /^(details|hide details)$/i.test((ctl.textContent ?? "").trim());
  });
  if (!ok) throw new Error(`tap target "${selector}" is not an in-app link or disclosure toggle -- refusing.`);
}

export async function runStepCapture(spec: StepCaptureSpec, outDir: string): Promise<StepCaptureResult> {
  assertLocal(spec.baseUrl);
  const framesDir = join(outDir, `${spec.id}.frames`);
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: spec.viewportCss,
    deviceScaleFactor: spec.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    storageState: spec.storageStatePath,
  });
  const page = await ctx.newPage();

  const list: { file: string; duration: number }[] = [];
  const timeline: StepTimelineEntry[] = [];
  const cutsAtSeconds: number[] = [];
  const taps: StepCaptureResult["taps"] = [];
  const measurements: StepCaptureResult["measurements"] = {};
  const holdChecks: StepCaptureResult["holdChecks"] = [];
  let t = 0;
  let n = 0;
  const visible = (selector: string) => page.locator(selector).locator("visible=true").first();

  const shoot = async (): Promise<{ file: string; bytes: Buffer }> => {
    const file = join(framesDir, `f${String(n++).padStart(5, "0")}.jpg`);
    const bytes = await page.screenshot({ path: file, type: "jpeg", quality: 95, caret: "hide" });
    return { file, bytes };
  };
  const push = (file: string, duration: number) => {
    list.push({ file, duration });
    t += duration;
  };

  try {
    for (const [i, step] of spec.steps.entries()) {
      const start = t;
      if (step.kind === "goto") {
        await page.goto(spec.baseUrl + step.route);
        await visible(step.waitFor).waitFor({ timeout: 15_000 });
        await page.waitForTimeout(1200);
        if (t > 0) cutsAtSeconds.push(t);
      } else if (step.kind === "hold") {
        const a = await shoot();
        push(a.file, step.seconds);
        await page.waitForTimeout(Math.min(step.seconds, 1.5) * 1000);
        const b = await page.screenshot({ type: "jpeg", quality: 95, caret: "hide" });
        holdChecks.push({ step: i, unchanged: Buffer.compare(a.bytes, b) === 0 });
      } else if (step.kind === "scroll") {
        const target = await visible(step.selector).evaluate(
          (el, o) => {
            const r = el.getBoundingClientRect();
            const top = r.top + window.scrollY;
            const want = o.block === "start" ? top - (o.offsetCss ?? 0) : top - (window.innerHeight - r.height) / 2 + (o.offsetCss ?? 0);
            const max = document.documentElement.scrollHeight - window.innerHeight;
            return Math.max(0, Math.min(max, Math.round(want)));
          },
          { block: step.block ?? "center", offsetCss: step.offsetCss },
        );
        const from = await page.evaluate(() => window.scrollY);
        const frames = Math.max(1, Math.round(step.seconds * FPS));
        for (let k = 1; k <= frames; k++) {
          const y = from + (target - from) * easeInOutCubic(k / frames);
          await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" as ScrollBehavior }), y);
          push((await shoot()).file, FRAME);
        }
      } else if (step.kind === "tap") {
        await assertReadOnlyTapTarget(visible(step.selector), step.selector);
        const box = await visible(step.selector).boundingBox();
        if (!box) throw new Error(`tap target "${step.selector}" has no box`);
        taps.push({ atSeconds: t, x: Math.round((box.x + box.width / 2) * spec.deviceScaleFactor), y: Math.round((box.y + box.height / 2) * spec.deviceScaleFactor) });
        const before = await shoot();
        push(before.file, FRAME * 3);
        await visible(step.selector).tap();
        const began = Date.now();
        let last = await shoot();
        let lastAt = 0;
        while ((Date.now() - began) / 1000 < step.settleSeconds) {
          const next = await shoot();
          const at = (Date.now() - began) / 1000;
          push(last.file, Math.max(FRAME, at - lastAt));
          last = next;
          lastAt = at;
        }
        push(last.file, Math.max(FRAME, step.settleSeconds - lastAt));
      } else if (step.kind === "measure") {
        const box = await visible(step.selector).boundingBox();
        if (!box) throw new Error(`measure target "${step.selector}" has no box`);
        const s = spec.deviceScaleFactor;
        measurements[step.name] = { atSeconds: t, x: Math.round(box.x * s), y: Math.round(box.y * s), w: Math.round(box.width * s), h: Math.round(box.height * s) };
      }
      timeline.push({ step: i, kind: step.kind, startSeconds: +start.toFixed(3), endSeconds: +t.toFixed(3), detail: "selector" in step ? step.selector : "route" in step ? step.route : undefined });
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  const listPath = join(framesDir, "concat.txt");
  const lines = list.flatMap((f) => [`file '${f.file.replace(/\\/g, "/")}'`, `duration ${f.duration.toFixed(4)}`]);
  lines.push(`file '${list[list.length - 1]!.file.replace(/\\/g, "/")}'`);
  writeFileSync(listPath, lines.join("\n"), "utf-8");

  const runner = createProcessRunner();
  const ringPath = join(framesDir, "ring.png");
  const ring = await runner.run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black@0:s=150x150,format=rgba", "-vf",
    "geq=r=255:g=255:b=255:a='if(between(hypot(X-75,Y-75),52,64),200,if(lt(hypot(X-75,Y-75),52),60,0))'", "-frames:v", "1", ringPath]);
  if (ring.exitCode !== 0) throw new Error(`ring build failed: ${ring.stderr}`);

  const outputPath = join(outDir, `${spec.id}.mp4`);
  const inputs = ["-f", "concat", "-safe", "0", "-i", listPath, ...taps.flatMap(() => ["-loop", "1", "-i", ringPath])];
  let chain = `[0:v]fps=${FPS},format=yuv420p[b0]`;
  taps.forEach((tp, k) => {
    const a = tp.atSeconds.toFixed(3);
    const b = (tp.atSeconds + 0.55).toFixed(3);
    chain += `;[${k + 1}:v]format=rgba,fade=t=out:st=${(tp.atSeconds + 0.3).toFixed(3)}:d=0.25:alpha=1[r${k}];[b${k}][r${k}]overlay=x=${tp.x - 75}:y=${tp.y - 75}:enable='between(t,${a},${b})':shortest=0:eof_action=pass[b${k + 1}]`;
  });
  const enc = await runner.run("ffmpeg", ["-y", ...inputs, "-filter_complex", chain, "-map", `[b${taps.length}]`, "-t", t.toFixed(3),
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath]);
  if (enc.exitCode !== 0) throw new Error(`encode failed: ${enc.stderr.slice(-2000)}`);

  return { outputPath, durationSeconds: +t.toFixed(3), timeline, cutsAtSeconds, taps, measurements, holdChecks };
}
