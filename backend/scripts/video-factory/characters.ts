/**
 * Rook and Tilt, the character duo that plays in a stage under the evidence card on every verified motion concept
 * (2026-09-26, owner request: something that entertains below the content while staying on topic).
 *
 * Both are flat vector cartoons drawn here as SVG, so there are no sprite files to keep in sync: each frame of the
 * stage is built as one SVG string and rasterised with resvg into a transparent PNG sequence, which render.ts
 * overlays in a single step. Everything that moves -- the idle bob, blinks, the squash on a pose change, mouth flaps
 * while a quip is up, and the speech bubble popping in -- is a pure function of time, so a frame is fully
 * determined by (beats, t) and unit-testable without rendering anything.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import type { CharacterBeat, CharacterName, CharacterPose } from "../../src/shortform/types.js";

const FRAME_RATE = 30;
const STAGE_WIDTH = 1080;
/** Stage height in the 1080x1920 frame; render.ts places it at CHARACTER_STAGE_TOP so it ends at TikTok's caption line. */
export const CHARACTER_STAGE_HEIGHT = 284;
/** Top of the desk both characters stand on, in stage coordinates. */
const DESK_TOP = 252;
/** Everything stays left of x=910: TikTok's right-hand buttons start at x=930 (render.ts PLATFORM_OVERLAY_ZONES). */
const DESK_LEFT = 30;
const DESK_RIGHT = 910;
const ROOK_X = 170;
const TILT_X = 780;

const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), "assets", "fonts", "Poppins-ExtraBold.ttf");
/** Directory (relative to the render directory) the frames are written to, and the image2 pattern ffmpeg reads. */
export const CHARACTER_FRAME_DIR = "characters";
export const CHARACTER_FRAME_PATTERN = `${CHARACTER_FRAME_DIR}/f%05d.png`;

interface Palette {
  hoodie: string;
  hoodieShade: string;
  skin: string;
  hair: string;
  pants: string;
}

const PALETTES: Record<CharacterName, Palette> = {
  // Rook wears the brand cyan (the card captions' accent, #22B8CF).
  rook: { hoodie: "#22B8CF", hoodieShade: "#178FA3", skin: "#F2C9A0", hair: "#1D2530", pants: "#223040" },
  tilt: { hoodie: "#FF7A45", hoodieShade: "#D9582A", skin: "#E3AC80", hair: "#3B2A5A", pants: "#2B2238" },
};

const INK = "#0B1620";

export interface TimedBeat {
  startSeconds: number;
  endSeconds: number;
  beat: CharacterBeat;
}

/* ------------------------------------------------------------------------------------------------ */
/* Timing                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

const BUBBLE_DELAY = 0.2;
const BUBBLE_POP = 0.22;
const BUBBLE_FADE = 0.12;
const TALK_DELAY = 0.3;
const ENTRANCE_SECONDS = 0.45;

/** How long the speaker's mouth moves: about a syllable-paced read of the quip, never past 1.8s. */
export function talkSeconds(quip: string): number {
  return Math.min(1.8, 0.35 + quip.length * 0.045);
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function beatAt(beats: TimedBeat[], t: number): TimedBeat | null {
  if (beats.length === 0) return null;
  for (const b of beats) if (t >= b.startSeconds && t < b.endSeconds) return b;
  // Past the last scene (the silence pad): hold the final beat.
  return t >= beats[beats.length - 1]!.endSeconds ? beats[beats.length - 1]! : beats[0]!;
}

/** Splits a quip into at most two bubble lines of about 19 characters, breaking only between words. */
export function wrapQuip(quip: string, maxLineChars = 19): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of quip.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLineChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 2) return [lines[0]!, lines.slice(1).join(" ")];
  return lines;
}

/* ------------------------------------------------------------------------------------------------ */
/* Drawing                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

type Mouth = "smile" | "grin" | "o" | "flat" | "side" | "talk";
type Eyes = "normal" | "wide" | "happy" | "closed" | "up";

interface PoseShape {
  /** Front hand (toward the other character) and back hand, with each arm's curve control point. Local coords: feet at 0,0, facing +x. */
  front: { hand: [number, number]; ctrl: [number, number] };
  back: { hand: [number, number]; ctrl: [number, number] };
  mouth: Mouth;
  eyes: Eyes;
  browLift: number;
  headTilt: number;
  pointFinger?: boolean;
  sweat?: boolean;
}

const HANG_BACK = { hand: [-50, -62] as [number, number], ctrl: [-62, -96] as [number, number] };

const POSES: Record<CharacterPose, PoseShape> = {
  idle: { front: { hand: [50, -62], ctrl: [62, -96] }, back: HANG_BACK, mouth: "smile", eyes: "normal", browLift: 0, headTilt: 0 },
  point: { front: { hand: [96, -200], ctrl: [84, -128] }, back: HANG_BACK, mouth: "smile", eyes: "up", browLift: 3, headTilt: -4, pointFinger: true },
  shock: { front: { hand: [72, -198], ctrl: [86, -146] }, back: { hand: [-72, -198], ctrl: [-86, -146] }, mouth: "o", eyes: "wide", browLift: 9, headTilt: 0, sweat: true },
  facepalm: { front: { hand: [12, -176], ctrl: [64, -128] }, back: HANG_BACK, mouth: "flat", eyes: "closed", browLift: -2, headTilt: 7 },
  think: { front: { hand: [16, -136], ctrl: [46, -96] }, back: { hand: [8, -86], ctrl: [-36, -84] }, mouth: "side", eyes: "up", browLift: 5, headTilt: -7 },
  cheer: { front: { hand: [80, -236], ctrl: [74, -168] }, back: { hand: [-80, -236], ctrl: [-74, -168] }, mouth: "grin", eyes: "happy", browLift: 4, headTilt: 4 },
  shrug: { front: { hand: [88, -126], ctrl: [70, -96] }, back: { hand: [-88, -126], ctrl: [-70, -96] }, mouth: "flat", eyes: "normal", browLift: 8, headTilt: 8 },
};

const HEAD_Y = -172;
const HEAD_R = 46;

function arm(shoulder: [number, number], a: { hand: [number, number]; ctrl: [number, number] }, p: Palette): string {
  const [sx, sy] = shoulder;
  const [cx, cy] = a.ctrl;
  const [hx, hy] = a.hand;
  return (
    `<path d="M ${sx} ${sy} Q ${cx} ${cy} ${hx} ${hy}" fill="none" stroke="${p.hoodieShade}" stroke-width="21" stroke-linecap="round"/>` +
    `<circle cx="${hx}" cy="${hy}" r="11.5" fill="${p.skin}" stroke="${INK}" stroke-width="2.5"/>`
  );
}

function eyesSvg(kind: Eyes, blink: boolean): string {
  const xs = [-9, 21];
  if (blink || kind === "closed") return xs.map((x) => `<path d="M ${x - 8} -176 Q ${x} -171 ${x + 8} -176" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`).join("");
  if (kind === "happy") return xs.map((x) => `<path d="M ${x - 8} -173 Q ${x} -184 ${x + 8} -173" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`).join("");
  const rx = kind === "wide" ? 11 : 9;
  const ry = kind === "wide" ? 14 : 11;
  const pr = kind === "wide" ? 4 : 5;
  const py = kind === "up" ? -181 : -175;
  return xs
    .map((x) => `<ellipse cx="${x}" cy="-176" rx="${rx}" ry="${ry}" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/><circle cx="${x + 2.5}" cy="${py}" r="${pr}" fill="${INK}"/>`)
    .join("");
}

function mouthSvg(kind: Mouth, openness: number): string {
  switch (kind) {
    case "talk": {
      const ry = 3 + 7 * openness;
      return `<ellipse cx="7" cy="-148" rx="10" ry="${ry.toFixed(1)}" fill="${INK}"/><ellipse cx="7" cy="${(-148 + ry * 0.45).toFixed(1)}" rx="5.5" ry="${(ry * 0.4).toFixed(1)}" fill="#E0566B"/>`;
    }
    case "grin":
      return `<path d="M -8 -153 Q 7 -130 22 -153 Z" fill="${INK}"/><path d="M -2 -142 Q 7 -136 16 -142" fill="#E0566B"/>`;
    case "o":
      return `<ellipse cx="7" cy="-147" rx="7" ry="9" fill="${INK}"/>`;
    case "flat":
      return `<path d="M -3 -148 L 17 -148" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    case "side":
      return `<path d="M 2 -147 Q 12 -150 20 -145" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
    default:
      return `<path d="M -4 -151 Q 7 -141 18 -151" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`;
  }
}

function hairSvg(name: CharacterName, p: Palette): string {
  if (name === "rook") {
    // Neat side-parted cut, plus the trader's headset.
    return (
      `<path d="M -46 -178 Q -48 -224 -2 -222 Q 44 -222 46 -184 Q 30 -204 -6 -200 Q -30 -198 -46 -178 Z" fill="${p.hair}"/>` +
      `<path d="M -50 -176 Q -52 -232 0 -232 Q 52 -232 50 -176" fill="none" stroke="#6B7F8E" stroke-width="7" stroke-linecap="round"/>` +
      `<rect x="-58" y="-190" width="16" height="30" rx="7" fill="#6B7F8E"/>` +
      `<path d="M -50 -166 Q -40 -138 -8 -140" fill="none" stroke="#6B7F8E" stroke-width="4" stroke-linecap="round"/>` +
      `<circle cx="-7" cy="-140" r="5" fill="#22B8CF"/>`
    );
  }
  // Tilt: a spiky mess that never quite settles.
  return `<path d="M -48 -172 L -54 -206 L -34 -198 L -32 -234 L -12 -212 L 0 -244 L 12 -214 L 30 -236 L 32 -204 L 54 -212 L 46 -180 Q 20 -200 -10 -196 Q -34 -192 -48 -172 Z" fill="${p.hair}"/>`;
}

function propSvg(name: CharacterName, pose: CharacterPose, shape: PoseShape): string {
  const [hx, hy] = shape.back.hand;
  if (name === "rook" && (pose === "idle" || pose === "point" || pose === "shrug")) {
    // The trading journal, always within reach.
    return `<g transform="translate(${hx} ${hy}) rotate(-12)"><rect x="-15" y="-22" width="30" height="38" rx="4" fill="#FFD23F" stroke="${INK}" stroke-width="2.5"/><rect x="-15" y="-22" width="7" height="38" fill="#E0AE14"/><path d="M -3 -10 H 9 M -3 -2 H 9" stroke="${INK}" stroke-width="2"/></g>`;
  }
  if (name === "tilt" && (pose === "idle" || pose === "cheer" || pose === "shrug" || pose === "point")) {
    // Tilt's energy drink.
    return `<g transform="translate(${hx} ${hy}) rotate(8)"><rect x="-10" y="-30" width="20" height="36" rx="4" fill="#9BE564" stroke="${INK}" stroke-width="2.5"/><rect x="-10" y="-30" width="20" height="6" fill="#C9C9C9"/><path d="M -4 -16 L 3 -12 L -3 -8 L 4 -4" fill="none" stroke="${INK}" stroke-width="2"/></g>`;
  }
  return "";
}

export interface CharacterFrameState {
  pose: CharacterPose;
  talking: boolean;
  mouthOpenness: number;
  blink: boolean;
}

/** One character, feet at 0,0, facing +x (the caller mirrors Tilt to face left). */
export function drawCharacter(name: CharacterName, state: CharacterFrameState): string {
  const p = PALETTES[name];
  const shape = POSES[state.pose];
  const mouth: Mouth = state.talking ? "talk" : shape.mouth;
  const brows = [-9, 21]
    .map((x) => `<path d="M ${x - 9} ${-194 - shape.browLift} Q ${x} ${-199 - shape.browLift} ${x + 9} ${-194 - shape.browLift}" fill="none" stroke="${p.hair}" stroke-width="4.5" stroke-linecap="round"/>`)
    .join("");
  const finger = shape.pointFinger
    ? `<path d="M ${shape.front.hand[0]} ${shape.front.hand[1]} l 9 -16" stroke="${p.skin}" stroke-width="8" stroke-linecap="round"/><path d="M ${shape.front.hand[0]} ${shape.front.hand[1]} l 9 -16" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>`
    : "";
  const sweat = shape.sweat ? `<path d="M 50 -206 Q 44 -192 50 -188 Q 56 -192 50 -206 Z" fill="#8FD8FF" stroke="${INK}" stroke-width="2"/>` : "";
  // Facepalm draws the hand over the face; every other pose draws the face over the torso and the arms over both.
  const frontArm = arm([36, -118], shape.front, p);
  const backArm = arm([-36, -118], shape.back, p);
  const head =
    `<g transform="rotate(${shape.headTilt} 0 ${HEAD_Y + 30})">` +
    `<circle cx="0" cy="${HEAD_Y}" r="${HEAD_R}" fill="${p.skin}" stroke="${INK}" stroke-width="3"/>` +
    `<ellipse cx="-44" cy="-170" rx="7" ry="11" fill="${p.skin}" stroke="${INK}" stroke-width="2.5"/>` +
    hairSvg(name, p) +
    brows +
    eyesSvg(shape.eyes, state.blink) +
    `<ellipse cx="-14" cy="-156" rx="7" ry="4" fill="#FF8A8A" opacity="0.45"/><ellipse cx="30" cy="-156" rx="7" ry="4" fill="#FF8A8A" opacity="0.45"/>` +
    mouthSvg(mouth, state.mouthOpenness) +
    sweat +
    `</g>`;
  return (
    `<ellipse cx="0" cy="2" rx="58" ry="9" fill="#000000" opacity="0.28"/>` +
    // Legs and shoes.
    `<rect x="-26" y="-62" width="20" height="58" rx="8" fill="${p.pants}"/><rect x="6" y="-62" width="20" height="58" rx="8" fill="${p.pants}"/>` +
    `<ellipse cx="-14" cy="-4" rx="18" ry="9" fill="#F4F7FA" stroke="${INK}" stroke-width="2.5"/><ellipse cx="20" cy="-4" rx="18" ry="9" fill="#F4F7FA" stroke="${INK}" stroke-width="2.5"/>` +
    backArm +
    propSvg(name, state.pose, shape) +
    // Hoodie torso, pocket and drawstrings.
    `<rect x="-46" y="-134" width="92" height="80" rx="30" fill="${p.hoodie}" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="-26" y="-92" width="52" height="24" rx="10" fill="${p.hoodieShade}"/>` +
    `<path d="M -8 -128 v 18 M 8 -128 v 18" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>` +
    (state.pose === "facepalm" ? head + frontArm + finger : frontArm + finger + head)
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The speech bubble, anchored so its tail points at the speaker's head. `scale` pops it in; `opacity` fades it out. */
export function drawBubble(speaker: CharacterName, quip: string, scale: number, opacity: number): string {
  if (scale <= 0 || opacity <= 0) return "";
  const lines = wrapQuip(quip);
  const fontSize = 30;
  const lineHeight = 38;
  const longest = Math.max(...lines.map((l) => l.length));
  const width = Math.min(380, Math.round(longest * 17.5 + 48));
  const height = lines.length * lineHeight + 30;
  const top = 34;
  const x = speaker === "rook" ? 272 : 668 - width;
  // Tail: out of the bubble's side nearest the speaker, toward their mouth (the head sits level with the bubble).
  const edge = speaker === "rook" ? x : x + width;
  const tailTip = speaker === "rook" ? { x: ROOK_X + 62, y: 112 } : { x: TILT_X - 62, y: 112 };
  const baseTop = top + height - 44;
  const baseBottom = top + height - 18;
  const pivotX = tailTip.x;
  const pivotY = tailTip.y;
  const text = lines
    .map((l, i) => `<text x="${x + width / 2}" y="${top + 15 + fontSize * 0.86 + i * lineHeight}" text-anchor="middle" font-family="Poppins" font-weight="800" font-size="${fontSize}" fill="${INK}">${escapeXml(l)}</text>`)
    .join("");
  return (
    `<g opacity="${opacity.toFixed(3)}" transform="translate(${pivotX} ${pivotY}) scale(${scale.toFixed(3)}) translate(${-pivotX} ${-pivotY})">` +
    `<path d="M ${edge} ${baseTop} L ${tailTip.x} ${tailTip.y} L ${edge} ${baseBottom} Z" fill="#FFFFFF" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>` +
    `<rect x="${x}" y="${top}" width="${width}" height="${height}" rx="24" fill="#FFFFFF" stroke="${INK}" stroke-width="4"/>` +
    // Covers the tail's inner stroke so the tail reads as part of the bubble.
    `<path d="M ${edge} ${baseTop + 3} L ${edge} ${baseBottom - 3}" stroke="#FFFFFF" stroke-width="7"/>` +
    text +
    `</g>`
  );
}

/** Per-character phase offsets so the two never bob or blink in lockstep. */
const PHASE: Record<CharacterName, number> = { rook: 0, tilt: 1.7 };

function characterGroup(name: CharacterName, beat: TimedBeat, t: number): string {
  const pose = beat.beat[name];
  const dt = t - beat.startSeconds;
  const phase = PHASE[name];
  const talkStart = TALK_DELAY;
  const talking = beat.beat.speaker === name && dt >= talkStart && dt < talkStart + talkSeconds(beat.beat.quip);
  const mouthOpenness = talking ? 0.5 + 0.5 * Math.sin((dt - talkStart) * 2 * Math.PI * 4.2) : 0;
  const blink = (t + phase * 1.3) % 3.4 < 0.12;

  let y = Math.sin(2 * Math.PI * 0.9 * t + phase) * 3;
  let x = 0;
  if (pose === "cheer") y -= Math.abs(Math.sin(2 * Math.PI * 1.8 * t + phase)) * 10;
  if (pose === "shock" && dt < 0.45) x += Math.sin(dt * 70) * 3;
  // Squash-and-stretch as each new pose lands.
  const k = clamp01(1 - dt / 0.28);
  const sy = 1 - 0.08 * k * Math.cos(dt * 24);
  const sx = 1 + 0.05 * k * Math.cos(dt * 24);
  // Both slide up from behind the desk at the start of the video.
  if (t < ENTRANCE_SECONDS) y += (1 - easeOutCubic(t / ENTRANCE_SECONDS)) * 260;

  const baseX = name === "rook" ? ROOK_X : TILT_X;
  const mirror = name === "tilt" ? -1 : 1;
  const body = drawCharacter(name, { pose, talking, mouthOpenness, blink: blink && !talking });
  return `<g transform="translate(${(baseX + x).toFixed(2)} ${(DESK_TOP + 4 + y).toFixed(2)}) scale(${(mirror * sx).toFixed(4)} ${sy.toFixed(4)})">${body}</g>`;
}

/** The full stage (desk, both characters, the speaker's bubble) at time `t`, as a standalone SVG document. */
export function buildStageSvg(beats: TimedBeat[], t: number): string {
  const current = beatAt(beats, t);
  let bubble = "";
  let characters = "";
  if (current) {
    const dt = t - current.startSeconds;
    const sceneLeft = current.endSeconds - t;
    const pop = clamp01((dt - BUBBLE_DELAY) / BUBBLE_POP);
    const scale = dt < BUBBLE_DELAY ? 0 : easeOutBack(pop);
    // The closing line stays up through the video's tail instead of fading with its scene.
    const isLast = current === beats[beats.length - 1];
    const opacity = !isLast && sceneLeft < BUBBLE_FADE ? clamp01(sceneLeft / BUBBLE_FADE) : 1;
    bubble = drawBubble(current.beat.speaker, current.beat.quip, scale, opacity);
    // The speaker is drawn last so a raised hand never tucks behind the other character.
    const order: CharacterName[] = current.beat.speaker === "rook" ? ["tilt", "rook"] : ["rook", "tilt"];
    characters = order.map((n) => characterGroup(n, current, t)).join("");
  }
  const desk =
    `<rect x="${DESK_LEFT}" y="${DESK_TOP}" width="${DESK_RIGHT - DESK_LEFT}" height="${CHARACTER_STAGE_HEIGHT - DESK_TOP - 4}" rx="14" fill="#0A1A26" opacity="0.92"/>` +
    `<rect x="${DESK_LEFT + 10}" y="${DESK_TOP}" width="${DESK_RIGHT - DESK_LEFT - 20}" height="3" rx="1.5" fill="#22B8CF" opacity="0.75"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${STAGE_WIDTH}" height="${CHARACTER_STAGE_HEIGHT}" viewBox="0 0 ${STAGE_WIDTH} ${CHARACTER_STAGE_HEIGHT}">` +
    characters +
    desk +
    bubble +
    `</svg>`
  );
}

export interface CharacterTrack {
  /** image2 pattern relative to the render directory (ffmpeg's cwd). */
  framePattern: string;
  frameCount: number;
}

/** Rasterises one frame per 1/30s across `durationSeconds` into `<outDir>/characters/`. Identical frames are encoded once. */
export function renderCharacterTrack(beats: TimedBeat[], durationSeconds: number, outDir: string): CharacterTrack {
  const dir = join(outDir, CHARACTER_FRAME_DIR);
  mkdirSync(dir, { recursive: true });
  const frameCount = Math.max(1, Math.ceil(durationSeconds * FRAME_RATE));
  const cache = new Map<string, Buffer>();
  for (let f = 0; f < frameCount; f++) {
    const svg = buildStageSvg(beats, f / FRAME_RATE);
    let png = cache.get(svg);
    if (!png) {
      png = new Resvg(svg, { font: { fontFiles: [FONT_PATH], loadSystemFonts: false, defaultFontFamily: "Poppins" } }).render().asPng();
      if (cache.size < 64) cache.set(svg, png);
    }
    writeFileSync(join(dir, `f${String(f + 1).padStart(5, "0")}.png`), png);
  }
  return { framePattern: CHARACTER_FRAME_PATTERN, frameCount };
}
