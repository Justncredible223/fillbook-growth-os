import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOCK_BOXES, MOCK_CANVAS, MOCK_FONT, MOCK_SAFE, type MockBoxName } from "../../src/shortform/mockLayout.js";
import type { ChartSpec, ChartTone } from "../../src/shortform/types.js";
import { VideoFactoryError } from "./types.js";

/**
 * The HTML renderer for the "mock" chart kind: the slide is laid out in HTML/CSS with the site's own typefaces and colour
 * tokens (assets/brand, copied from the fillbook repo), then screenshotted by headless Chromium at the final
 * 1080x1920, one still per beat (chart.stage). The still becomes the scene's background in the adapter; there is no
 * ASS text on a mock scene, so every glyph on it is in the brand type.
 *
 * Geometry is fixed (mockLayout.ts) and validated before anything renders. After rendering, the page is measured: every
 * box must sit inside the area TikTok and YouTube Shorts leave clear, and no text may overflow its box. Either failure
 * throws, so a slide that would be covered by a platform button or a caption never reaches a video.
 */
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "assets", "brand");

export interface MockFrame {
  chart: ChartSpec;
  headline: string;
  captionText: string;
  cta: string | null;
}

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (name: string): string => pathToFileURL(join(ASSETS, name)).href;
const toneClass = (t: ChartTone): string => (t === "bad" ? "bad" : "good");

const CSS = `
@font-face{font-family:SG;src:url(${url("space-grotesk-latin-wght-normal.woff2")}) format('woff2');font-weight:300 700}
@font-face{font-family:MR;src:url(${url("manrope-latin-wght-normal.woff2")}) format('woff2');font-weight:200 800}
@font-face{font-family:JB;src:url(${url("jetbrains-mono-latin-wght-normal.woff2")}) format('woff2');font-weight:100 800}
:root{--bg0:#07090d;--bg1:#0d1117;--bg2:#111720;--line:#1f2b35;--ink:#e7edf3;--mute:#a9b7c4;--dim:#7f8e9b;--cyan:#22b8dc;--good:#34d399;--bad:#f87171}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${MOCK_CANVAS.width}px;height:${MOCK_CANVAS.height}px;overflow:hidden}
body{position:relative;color:var(--ink);font-family:MR,sans-serif;background:radial-gradient(1100px 800px at 88% 6%,#0c2a33 0%,#07090d 62%)}
[data-box]{position:absolute}
${Object.entries(MOCK_BOXES).map(([n, b]) => `[data-box=${n}]{left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px}`).join("\n")}
.logo{height:58px}
.eyebrow{font:700 28px/36px MR;letter-spacing:.16em;color:var(--cyan);white-space:nowrap;overflow:hidden}
.headline{font:700 ${MOCK_FONT.headline}px/${MOCK_FONT.headlineLine}px SG;letter-spacing:-.02em;overflow:hidden}
.headline div{white-space:nowrap;overflow:hidden;height:${MOCK_FONT.headlineLine}px}.headline .accent{color:var(--cyan)}
.win{border:2px solid var(--line);border-radius:26px;background:var(--bg1);overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.55)}
.bar{display:flex;align-items:center;gap:12px;height:64px;padding:0 28px;border-bottom:2px solid var(--line);font:600 24px MR;color:var(--dim);white-space:nowrap}
.dot{width:16px;height:16px;border-radius:50%;background:#252f3b;flex:none}
.bar .t{margin-left:14px}.bar .tag{margin-left:auto;font-size:20px;letter-spacing:.12em}
table{width:100%;border-collapse:collapse}
th{height:56px;font:700 20px MR;letter-spacing:.14em;color:var(--dim);text-align:left;padding:0 28px;white-space:nowrap}
td{height:90px;font:500 32px JB;padding:0 28px;border-top:2px solid var(--line);white-space:nowrap}
.r{text-align:right}.bad{color:var(--bad)}.good{color:var(--good)}
.step{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.step span{border:2px solid #14566a;background:#0b2b34;color:var(--cyan);font:700 24px MR;letter-spacing:.14em;border-radius:999px;padding:12px 30px;white-space:nowrap}
.step svg{width:44px;height:44px;stroke:var(--cyan);fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.stats{display:flex;gap:20px;padding:18px 28px 18px}
.stat{flex:1;height:214px;border:2px solid var(--line);border-radius:20px;background:var(--bg2);padding:16px 22px;overflow:hidden}
.stat .k{font:700 18px/24px MR;letter-spacing:.12em;color:var(--dim);height:48px;overflow:hidden}
.stat .v{font:700 64px/72px SG;white-space:nowrap}.stat .v small{font:600 26px MR;color:var(--mute);margin-left:8px}
.meter{height:14px;border-radius:9px;background:#1b2531;margin-top:14px;position:relative}
.meter i{position:absolute;left:0;top:0;bottom:0;width:100%;border-radius:9px;background:linear-gradient(90deg,#0891b2,#22b8dc)}
.meter b{position:absolute;top:-6px;bottom:-6px;width:3px;background:var(--ink)}
.note{font:600 20px/26px MR;color:var(--dim);margin-top:8px;white-space:nowrap}
.caption{font:700 ${MOCK_FONT.caption}px/${MOCK_BOXES.caption.h}px MR;color:var(--ink);white-space:nowrap;overflow:hidden}
.cta{display:flex;align-items:center;justify-content:center;text-align:center;border:2px solid #14566a;background:#0b2b34;border-radius:28px;padding:0 44px;font:700 46px/60px SG;color:var(--ink)}
.det td{height:84px;font:600 30px MR;color:var(--ink)}.det td.r{font:700 32px JB}
.win.d{display:flex;flex-direction:column}.win.d .foot{margin-top:auto}
.foot{height:60px;line-height:60px;padding:0 28px;border-top:2px solid var(--line);font:600 24px MR;color:var(--mute);letter-spacing:.04em;white-space:nowrap}
.hl{outline:4px solid var(--cyan);outline-offset:-4px;border-radius:14px}
.dim{opacity:.3}
.hidden{visibility:hidden}
`;

/** A figure on its own in a line of text ("$657", "-$57", "71%", "2.5x", "$3,822"), so it can count up. A time such as "10:30" is not one. */
const COUNT_TOKEN = /(?<![\w:.,])-?\$?\d[\d,]*(?:\.\d+)?[%x]?(?=[.,]?(?:\s|$))/g;

/**
 * The page's animation driver. seek(t) draws every element at t ms into the beat, so a frame is a pure function of its time
 * (no running animation to race the screenshot); seek(Infinity) is the finished slide, identical to the old still.
 */
const PAGE_SCRIPT = `
const ease = (p) => 1 - Math.pow(1 - p, 3);
const DUR = 460;
function fmt(target, t) {
  const m = target.match(/^(-?)(\\$?)(\\d[\\d,]*)(\\.\\d+)?([%x]?)$/);
  if (!m) return target;
  const dec = m[4] ? m[4].length - 1 : 0, comma = m[3].includes(","), full = parseFloat(m[3].replace(/,/g, "") + (m[4] || ""));
  let v = (full * t).toFixed(dec);
  if (comma) v = Number(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return m[1] + m[2] + v + m[5];
}
window.seek = (ms) => {
  for (const el of document.querySelectorAll("[data-a]")) {
    const kind = el.dataset.a, p = Math.min(1, Math.max(0, (ms - Number(el.dataset.d)) / DUR)), e = ease(p);
    const cells = el.tagName === "TR" ? [...el.children] : [el];
    if (kind === "dimin") el.style.opacity = String(1 - 0.7 * e);
    else el.style.opacity = String(e);
    if (kind === "slideup") el.style.transform = "translateY(" + (1 - e) * 70 + "px)";
    if (kind === "pop") el.style.transform = "scale(" + (0.9 + 0.1 * e) + ")";
    if (kind === "dimin") el.style.opacity = String(1 - 0.7 * e);
    if (kind === "rowin") for (const c of cells) c.style.transform = "translateX(" + (1 - e) * -50 + "px)";
    if (kind === "grow") { el.style.opacity = "1"; el.style.transformOrigin = "left"; el.style.transform = "scaleX(" + e + ")"; }
  }
  for (const el of document.querySelectorAll("[data-count]")) {
    const delay = Number(el.closest("[data-d]")?.dataset.d ?? 0) + 120;
    const p = Math.min(1, Math.max(0, (ms - (el.dataset.delay ? Number(el.dataset.delay) : delay)) / 700));
    const u = el.querySelector("small");
    const text = fmt(el.dataset.count, ease(p));
    if (u) el.firstChild.textContent = text; else el.textContent = text;
  }
};
`;

/** The slide's HTML for one beat. Pure: the same frame always gives the same markup. */
export function buildMockHtml(frame: MockFrame): string {
  const { chart } = frame;
  const m = chart.mock;
  if (!m) throw new VideoFactoryError("mockCard: a mock chart scene has no mock spec (validateScenePlan should have refused it).");
  const stage = chart.stage;
  const closing = chart.dim === true;
  // Stage 4 of a mock with details swaps the step and result windows for the detail card.
  const detail = m.details !== undefined && stage === 4 && !closing;
  const showResult = stage >= 2 && !detail;
  const lastRow = m.source.rows.length - 1;
  const box = (name: MockBoxName): string => `data-box="${name}"`;
  // Entrance motion: each element that appears or changes on this beat carries data-a (kind) and data-d (delay, ms); seek() in the page draws it.
  const a = (kind: string, delay: number): string => ` data-a="${kind}" data-d="${delay}"`;
  const first = stage === 1;
  const lines = chart.lines
    .map((l, i) => {
      // On the opening beat the figures in the headline count up from zero, so frame one already moves.
      const text = first ? esc(l).replace(COUNT_TOKEN, (t) => `<span data-count="${t}">${t}</span>`) : esc(l);
      return `<div class="${i >= m.accentFrom ? "accent" : ""}"${first ? a("slideup", 60 + i * 110) : ""}>${text}</div>`;
    })
    .join("");
  const rows = m.source.rows
    .map((r, i) => `<tr${first ? a("rowin", 380 + i * 120) : ""}><td>${esc(r.when)}</td><td>${esc(r.symbol)}</td><td class="r ${toneClass(r.tone)}${stage === 3 && i === lastRow ? " hl" : ""}">${esc(r.value)}</td></tr>`)
    .join("");
  const stats = m.result.stats
    .map((s, i) => {
      const meter = s.meter ? `<div class="meter"><i${stage === 2 ? a("grow", 520) : ""}></i><b style="left:${Math.round(s.meter.markAt * 1000) / 10}%"></b></div>` : "";
      const unit = s.unit ? `<small>${esc(s.unit)}</small>` : "";
      const note = s.note ? `<div class="note">${esc(s.note)}</div>` : "";
      return `<div class="stat${stage === 3 && i === 1 ? " hl" : ""}"${stage === 3 && i === 1 ? a("pop", 0) : ""}><div class="k">${esc(s.label)}</div><div class="v"${stage === 2 ? ` data-count="${esc(s.value)}"` : ""}>${esc(s.value)}${unit}</div>${meter}${note}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>
<img ${box("logo")} class="logo" src="${url("fillbook-horizontal-white.svg")}">
<div ${box("eyebrow")} class="eyebrow" data-fit${first ? a("fade", 0) : ""}>${esc(m.eyebrow)}</div>
<div ${box("headline")} class="headline" data-fit>${lines}</div>
<div ${box("source")} class="win${closing ? "" : ""}"${first ? a("slideup", 220) : closing ? a("dimin", 0) : ""}><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">${esc(m.source.title)}</span></div>
<table><tr><th>${esc(m.source.columns[0])}</th><th>${esc(m.source.columns[1])}</th><th class="r">${esc(m.source.columns[2])}</th></tr>${rows}</table></div>
<div ${box("step")} class="step${showResult ? "" : " hidden"}"${stage === 2 ? a("pop", 0) : closing ? a("dimin", 0) : ""}><span>${esc(m.step)}</span><svg viewBox="0 0 44 44"><path d="M22 6v30M10 25l12 12 12-12"/></svg></div>
<div ${box("result")} class="win${showResult ? "" : " hidden"}"${stage === 2 ? a("slideup", 120) : closing ? a("dimin", 0) : ""}><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">${esc(m.result.title)}</span><span class="tag">${esc(m.result.tag.toUpperCase())}</span></div>
<div class="stats">${stats}</div></div>
${m.details ? `<div ${box("detail")} class="win d${detail ? "" : " hidden"}"${detail ? a("slideup", 0) : ""}><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">${esc(m.details.title)}</span><span class="tag">${esc(m.result.tag.toUpperCase())}</span></div>
<table class="det">${m.details.rows.map((r, i) => `<tr${a("rowin", 260 + i * 130)}><td>${esc(r.label)}</td><td class="r ${toneClass(r.tone)}">${esc(r.value)}</td></tr>`).join("")}</table><div class="foot"${a("fade", 760)}>${esc(m.details.footer)}</div></div>` : ""}
<div ${box("caption")} class="caption" data-fit${a("fade", first ? 520 : 300)}>${esc(frame.captionText)}</div>
${frame.cta ? `<div ${box("cta")} class="cta"${a("pop", 120)}>${esc(frame.cta)}</div>` : ""}
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}

/** Where Chromium lives: an explicit env override, Playwright's own install, or the pre-installed browser some environments ship. */
function chromiumPath(): string | undefined {
  const fromEnv = process.env.MOCK_CHROMIUM_PATH ?? process.env.CHROMIUM_EXECUTABLE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const preinstalled = "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

/** True when a browser for the mock slides can be found (an override, the pre-installed one, or Playwright's own install). Lets tests that really render skip where there is none. */
export async function chromiumAvailable(): Promise<boolean> {
  if (chromiumPath()) return true;
  try {
    const { chromium } = await import("playwright-core");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

interface Measured {
  box: string;
  x: number;
  y: number;
  w: number;
  h: number;
  overflowX: number;
  overflowY: number;
  fit: boolean;
}

/** Problems found by measuring the rendered page, as plain messages (empty = every box is clear of the platform overlays and no text overflows). */
export function measuredProblems(measured: Measured[]): string[] {
  const out: string[] = [];
  const right = MOCK_SAFE.x + MOCK_SAFE.w;
  const bottom = MOCK_SAFE.y + MOCK_SAFE.h;
  for (const m of measured) {
    if (m.x < MOCK_SAFE.x - 1 || m.y < MOCK_SAFE.y - 1 || m.x + m.w > right + 1 || m.y + m.h > bottom + 1) {
      out.push(`${m.box} renders at x ${Math.round(m.x)}-${Math.round(m.x + m.w)}, y ${Math.round(m.y)}-${Math.round(m.y + m.h)}, outside the clear area x ${MOCK_SAFE.x}-${right}, y ${MOCK_SAFE.y}-${bottom}.`);
    }
    if (m.fit && (m.overflowX > 1 || m.overflowY > 1)) out.push(`${m.box}'s text overflows its box by ${Math.round(m.overflowX)}px across and ${Math.round(m.overflowY)}px down.`);
  }
  return out;
}

/** The entrance of every beat: how long it takes and the frame rate it is drawn at. */
export const MOCK_ENTRANCE = { seconds: 1.0, fps: 30 } as const;

export interface MockRenderer {
  render(frame: MockFrame, outPath: string): Promise<string>;
  /** The finished slide plus its entrance as numbered frames (`<prefix>-000.png` ...). Returns the finished still and the frame pattern. */
  renderBeat(frame: MockFrame, outDir: string, prefix: string): Promise<{ stillPath: string; pattern: string; count: number }>;
  close(): Promise<void>;
}

/** One headless Chromium for a whole video's mock scenes. `playwright-core` is loaded lazily so a plan with no mock scene never needs a browser. */
export async function createMockRenderer(workDir: string): Promise<MockRenderer> {
  const { chromium } = await import("playwright-core");
  mkdirSync(workDir, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: chromiumPath() });
  } catch (err) {
    throw new VideoFactoryError(`mockCard: could not start Chromium (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). Install it with "npx playwright install chromium", or set MOCK_CHROMIUM_PATH.`);
  }
  const page = await browser.newPage({ viewport: { width: MOCK_CANVAS.width, height: MOCK_CANVAS.height }, deviceScaleFactor: 1 });
  const load = async (frame: MockFrame, outPath: string): Promise<void> => {
      const htmlPath = outPath.replace(/\.png$/i, ".html");
      writeFileSync(htmlPath, buildMockHtml(frame), "utf-8");
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      const fonts = await page.evaluate(() => [...document.fonts].map((f) => `${f.family}:${f.status}`));
      if (!["SG:loaded", "MR:loaded", "JB:loaded"].every((f) => fonts.includes(f))) throw new VideoFactoryError(`mockCard: the brand fonts did not load (${fonts.join(", ")}).`);
      const measured: Measured[] = await page.evaluate(() =>
        [...document.querySelectorAll("[data-box]")]
          .filter((el) => getComputedStyle(el).visibility !== "hidden")
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              box: (el as HTMLElement).dataset.box ?? "?",
              x: r.x, y: r.y, w: r.width, h: r.height,
              overflowX: el.scrollWidth - el.clientWidth,
              overflowY: el.scrollHeight - el.clientHeight,
              fit: el.hasAttribute("data-fit"),
            };
          }),
      );
      const problems = measuredProblems(measured);
      if (problems.length > 0) throw new VideoFactoryError(`mockCard: "${outPath}" would be covered by a platform overlay or clipped:\n${problems.join("\n")}`);
      // The finished slide is what is measured and what is held after the entrance.
      await page.evaluate(() => (window as unknown as { seek(ms: number): void }).seek(Infinity));
    };
  return {
    async render(frame, outPath) {
      await load(frame, outPath);
      await page.screenshot({ path: outPath });
      return outPath;
    },
    async renderBeat(frame, outDir, prefix) {
      const stillPath = join(outDir, `${prefix}.png`);
      await load(frame, stillPath);
      await page.screenshot({ path: stillPath });
      const count = Math.round(MOCK_ENTRANCE.seconds * MOCK_ENTRANCE.fps);
      for (let i = 0; i < count; i++) {
        await page.evaluate((ms) => (window as unknown as { seek(ms: number): void }).seek(ms), (i * 1000) / MOCK_ENTRANCE.fps);
        await page.screenshot({ path: join(outDir, `${prefix}-${String(i).padStart(3, "0")}.png`) });
      }
      return { stillPath, pattern: `${prefix}-%03d.png`, count };
    },
    async close() {
      await browser.close();
    },
  };
}
