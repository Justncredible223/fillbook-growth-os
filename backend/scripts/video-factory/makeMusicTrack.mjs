#!/usr/bin/env node
// Generates a royalty-free background-music bed for a short video, entirely
// in JS (no ffmpeg, no assets, no licences). The same --seed always produces
// the same track; a different seed (e.g. the video slug) changes key, scale,
// chord progression, tempo and texture so videos stop sharing one bed.
//
//   node scripts/social/make-bgm.mjs --seed read-this-before-your-first-trade \
//        --duration 20 --out bgm.wav
//
// Mix under the voiceover with ffmpeg (see docs/social/VIDEO_PRODUCTION_WORKFLOW.md).

import { writeFileSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]])
    return acc
  }, []),
)
const seed = args.seed ?? String(Date.now())
const duration = Number(args.duration ?? 20)
const out = args.out ?? 'bgm.wav'
if (!(duration > 0 && duration <= 600)) throw new Error("--duration must be 1-600 seconds")

const SR = 32000

// cyrb128-style string hash -> mulberry32 PRNG
function hash(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}
function prng(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = prng(hash(seed))
for (let i = 0; i < 8; i++) rnd() // warm up so near-identical seeds diverge
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
}
// Scale degrees (0-based) for each bar's chord; every progression is 4 bars.
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 4, 3],
  [5, 3, 0, 4],
  [0, 2, 5, 4],
  [0, 4, 5, 3],
]
const root = 45 + Math.floor(rnd() * 12) // A2..G#3
const scaleName = pick(Object.keys(SCALES))
const scale = SCALES[scaleName]
const prog = pick(PROGRESSIONS)
const bpm = 82 + Math.floor(rnd() * 40) // 82-121
const arpPattern = pick([[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 3]])
const arpDiv = pick([2, 4]) // notes per beat
const arpWave = pick(['sine', 'tri'])
const padWave = pick(['sine', 'tri'])
const pulse = rnd() < 0.6
const swing = rnd() < 0.3 ? 0.12 : 0

const mtof = (m) => 440 * 2 ** ((m - 69) / 12)
const degreeMidi = (deg) => root + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7)
const chord = (deg) => [degreeMidi(deg), degreeMidi(deg + 2), degreeMidi(deg + 4), degreeMidi(deg + 7)]

function osc(kind, phase) {
  if (kind === 'tri') return 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1
  return Math.sin(2 * Math.PI * phase)
}

const n = Math.floor(duration * SR)
const buf = new Float32Array(n)
const beat = 60 / bpm
const bar = beat * 4

for (let i = 0; i < n; i++) {
  const t = i / SR
  const barIdx = Math.floor(t / bar)
  const tb = t - barIdx * bar
  const notes = chord(prog[barIdx % prog.length])

  // pad: three chord tones, slow swell per bar
  const padEnv = Math.min(1, tb / 0.4) * Math.min(1, (bar - tb) / 0.5)
  let s = 0
  for (let k = 0; k < 3; k++) {
    const f = mtof(notes[k] - 12)
    s += 0.1 * osc(padWave, f * t) + 0.05 * osc(padWave, f * 1.004 * t)
  }
  s *= 0.5 + 0.5 * padEnv

  // arpeggio: plucked notes with exponential decay
  const step = beat / arpDiv
  const sIdx = Math.floor(tb / step)
  const st = tb - sIdx * step - (sIdx % 2 ? swing * step : 0)
  if (st >= 0) {
    const note = notes[arpPattern[sIdx % arpPattern.length]] + 12
    s += 0.16 * osc(arpWave, mtof(note) * t) * Math.exp(-st * 7) * Math.min(1, st * 400)
  }

  // soft pulse on the beat (low thump, no harsh transient)
  if (pulse) {
    const bt = tb % beat
    s += 0.22 * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 9)
  }
  buf[i] = s
}

// global fade in/out and normalise to a modest peak (headroom for the mix)
const fade = Math.min(1.5, duration / 4)
let peak = 0
for (let i = 0; i < n; i++) {
  const t = i / SR
  buf[i] *= Math.min(1, t / fade) * Math.min(1, (duration - t) / fade)
  peak = Math.max(peak, Math.abs(buf[i]))
}
const gain = peak > 0 ? 0.7 / peak : 1

const pcm = Buffer.alloc(44 + n * 2)
pcm.write('RIFF', 0)
pcm.writeUInt32LE(36 + n * 2, 4)
pcm.write('WAVEfmt ', 8)
pcm.writeUInt32LE(16, 16)
pcm.writeUInt16LE(1, 20)
pcm.writeUInt16LE(1, 22)
pcm.writeUInt32LE(SR, 24)
pcm.writeUInt32LE(SR * 2, 28)
pcm.writeUInt16LE(2, 32)
pcm.writeUInt16LE(16, 34)
pcm.write('data', 36)
pcm.writeUInt32LE(n * 2, 40)
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), 44 + i * 2)
writeFileSync(out, pcm)

console.log(JSON.stringify({ out, seed, duration, bpm, rootMidi: root, scale: scaleName, progression: prog, pulse }))
