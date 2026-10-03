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
const STYLES = ['ambient', 'lofi', 'drive', 'piano', 'corporate', 'synthwave', 'deephouse', 'cinematic']
const style = args.style ?? 'ambient'
if (!STYLES.includes(style)) throw new Error(`--style must be one of ${STYLES.join(', ')}`)
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
let beat = 60 / bpm
let bar = beat * 4

if (style === 'ambient') {
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


} else {
  renderStyle()
}

// ---------------------------------------------------------------------------------------------------------------------
// Styled engine: drums, bass, chord/lead voices and a few effects, driven by per-style 16-step patterns. Everything is
// synthesised from oscillators and noise (no samples), and the seed picks key, scale, tempo, progression and variations.
// ---------------------------------------------------------------------------------------------------------------------
function renderStyle() {
  const noiseRnd = prng(hash(seed + ':noise'))
  const P = {
    lofi: { bpm: [74, 84], scales: ['dorian', 'minor'], swing: 0.16, kick: [1,0,0,0, 0,0,0,.5, 0,0,.9,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,.3], hat: [.5,0,.35,0, .5,0,.35,0, .5,0,.35,0, .5,0,.35,.2], chordMode: 'rhodes', chordSteps: [0,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0], bass: 'sine', bassSteps: [1,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0], vinyl: 0.018, lp: 4200, echo: 0 },
    drive: { bpm: [120, 128], scales: ['minor', 'dorian'], swing: 0, kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [0,0,.6,0, 0,0,.6,0, 0,0,.6,0, 0,0,.6,0], openHat: [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0], chordMode: 'pad', bass: 'saw', bassSteps: [1,0,1,1, 0,1,0,1, 1,0,1,1, 0,1,1,0], arpDiv: 4, arpWave: 'tri', arpGain: 0.1, sidechain: true, lp: 9000, echo: 0.18 },
    piano: { bpm: [62, 74], scales: ['major', 'lydian', 'dorian'], swing: 0.05, chordMode: 'piano', pianoSteps: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], bass: 'sine', bassSteps: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], lp: 6500, echo: 0.28 },
    corporate: { bpm: [104, 114], scales: ['major', 'lydian'], swing: 0, kick: [1,0,0,0, 0,0,0,0, 1,0,.8,0, 0,0,0,0], clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [0,0,.5,0, 0,0,.5,0, 0,0,.5,0, 0,0,.5,.3], chordMode: 'stab', chordSteps: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0], bass: 'tri', bassSteps: [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0], arpDiv: 2, arpWave: 'tri', arpGain: 0.12, lp: 8500, echo: 0.1 },
    synthwave: { bpm: [96, 106], scales: ['minor', 'dorian'], swing: 0, kick: [1,0,0,0, 0,0,0,0, 1,0,.7,0, 0,0,0,0], snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [.5,0,.5,0, .5,0,.5,0, .5,0,.5,0, .5,0,.5,0], chordMode: 'saw', chordSteps: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0], bass: 'saw', bassSteps: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0], arpDiv: 2, arpWave: 'saw', arpGain: 0.08, lp: 7000, echo: 0.22 },
    deephouse: { bpm: [118, 124], scales: ['minor', 'dorian'], swing: 0.04, kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0], clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0], hat: [0,0,0,.4, 0,0,0,.4, 0,0,0,.4, 0,0,0,.4], openHat: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0], chordMode: 'stab', chordSteps: [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1], bass: 'sine', bassSteps: [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0], sidechain: true, lp: 8000, echo: 0.12 },
    cinematic: { bpm: [84, 92], scales: ['minor'], swing: 0, kick: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], chordMode: 'drone', bass: 'sine', bassSteps: [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], bells: true, riser: true, lp: 7500, echo: 0.3 },
  }[style]

  const bpmS = P.bpm[0] + Math.floor(rnd() * (P.bpm[1] - P.bpm[0] + 1))
  beat = 60 / bpmS
  bar = beat * 4
  const sc = SCALES[pick(P.scales)]
  const rootS = 40 + Math.floor(rnd() * 12) // E2..D#3
  const progS = pick(PROGRESSIONS)
  const swingS = P.swing
  const step16 = beat / 4
  const degMidi = (deg) => rootS + sc[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7)
  const chordS = (deg) => [degMidi(deg), degMidi(deg + 2), degMidi(deg + 4), degMidi(deg + 7)]
  const arpPat = pick([[0, 1, 2, 1], [0, 2, 1, 2], [2, 1, 0, 1], [0, 1, 2, 3]])
  const melodyLift = pick([0, 12])

  // time since the most recent hit of a 16-step pattern (and its velocity), looking back up to `back` steps
  const lastHit = (pat, stepIdx, tStep, back) => {
    for (let k = 0; k < back; k++) {
      const j = stepIdx - k
      if (j < 0) break
      const v = pat[((j % 16) + 16) % 16]
      if (v) {
        const off = (j % 2 ? swingS * step16 : 0)
        const dt = tStep + k * step16 - off
        if (dt >= 0) return [dt, v]
      }
    }
    return null
  }
  const nz = () => noiseRnd() * 2 - 1
  let hatLP = 0, bassLP = 0, vinylLP = 0, riserLP = 0, delayBuf = null, delayIdx = 0
  const dl = Math.floor(SR * (beat * 0.75))
  if (P.echo) delayBuf = new Float32Array(dl)
  let lpState = 0
  const lpA = 1 - Math.exp(-2 * Math.PI * P.lp / SR)

  for (let i = 0; i < n; i++) {
    const t = i / SR
    const stepIdx = Math.floor(t / step16)
    const tStep = t - stepIdx * step16
    const barIdx = Math.floor(t / bar)
    const tb = t - barIdx * bar
    const deg = progS[barIdx % progS.length]
    const notes = chordS(deg)
    let s = 0
    let duck = 1

    // --- drums
    let kh = P.kick && lastHit(P.kick, stepIdx, tStep, 6)
    if (kh) {
      const [dt, v] = kh
      const k = Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-dt * 38)) * dt) * Math.exp(-dt * 8)
      s += 0.55 * v * k
      if (P.sidechain) duck = Math.min(duck, 1 - 0.55 * Math.exp(-dt * 9))
    }
    const sn = P.snare && lastHit(P.snare, stepIdx, tStep, 4)
    if (sn) {
      const [dt, v] = sn
      s += 0.3 * v * (nz() * Math.exp(-dt * 20) * 0.6 + Math.sin(2 * Math.PI * 185 * dt) * Math.exp(-dt * 26) * 0.5)
    }
    const cl = P.clap && lastHit(P.clap, stepIdx, tStep, 4)
    if (cl) {
      const [dt, v] = cl
      const burst = Math.exp(-((dt * 1000) % 11) * 0.25) // three quick bursts, then a tail
      s += 0.24 * v * nz() * (dt < 0.03 ? burst : Math.exp(-dt * 16))
    }
    const raw = nz()
    hatLP += 0.35 * (raw - hatLP)
    const hp = raw - hatLP // crude high-pass: noise minus its low-passed copy
    const ch = P.hat && lastHit(P.hat, stepIdx, tStep, 2)
    if (ch) s += 0.2 * ch[1] * hp * Math.exp(-ch[0] * 70)
    const oh = P.openHat && lastHit(P.openHat, stepIdx, tStep, 3)
    if (oh) s += 0.14 * oh[1] * hp * Math.exp(-oh[0] * 14)

    // --- bass
    const bh = P.bassSteps && lastHit(P.bassSteps, stepIdx, tStep, 6)
    if (bh) {
      const [dt] = bh
      const bn = notes[0] - 12 - (P.bass === 'sine' ? 0 : 0)
      const f = mtof(bn)
      const ph = (f * t) % 1
      let w
      if (P.bass === 'saw') w = 2 * ph - 1
      else if (P.bass === 'tri') w = 2 * Math.abs(2 * (ph - Math.floor(ph + 0.5))) - 1
      else w = Math.sin(2 * Math.PI * ph) + 0.25 * Math.sin(4 * Math.PI * ph)
      bassLP += (P.bass === 'saw' ? 0.06 : 0.12) * (w - bassLP)
      s += 0.42 * bassLP * Math.min(1, dt * 300) * Math.exp(-dt * (P.bass === 'saw' ? 3.2 : 2.2))
    }

    // --- harmony
    const mode = P.chordMode
    if (mode === 'pad' || mode === 'drone') {
      const padEnv = Math.min(1, tb / 0.5) * Math.min(1, (bar - tb) / 0.6)
      let pd = 0
      for (let k = 0; k < 3; k++) {
        const f = mtof(notes[k] - (mode === 'drone' ? 24 : 12))
        pd += 0.09 * osc('tri', f * t) + 0.05 * osc('sine', f * 1.005 * t)
      }
      if (mode === 'drone') pd += 0.16 * osc('sine', mtof(notes[0] - 24) * t)
      s += pd * (0.55 + 0.45 * padEnv) * duck
    } else if (mode === 'rhodes' || mode === 'stab' || mode === 'saw') {
      const h = lastHit(P.chordSteps, stepIdx, tStep, 8)
      if (h) {
        const [dt] = h
        let cs = 0
        for (let k = 0; k < 4; k++) {
          const f = mtof(notes[k] + (mode === 'rhodes' ? 0 : 12))
          if (mode === 'rhodes') cs += 0.1 * (osc('sine', f * t) + 0.35 * osc('sine', f * 2 * t) * Math.exp(-dt * 6)) * (1 + 0.15 * Math.sin(2 * Math.PI * 5 * t))
          else if (mode === 'saw') cs += 0.05 * (2 * ((f * t) % 1) - 1) + 0.05 * (2 * ((f * 1.006 * t) % 1) - 1)
          else cs += 0.09 * osc('tri', f * t) + 0.04 * osc('sine', f * 2 * t)
        }
        const dec = mode === 'rhodes' ? 2.4 : mode === 'saw' ? 1.8 : 5.5
        s += cs * Math.exp(-dt * dec) * Math.min(1, dt * 220) * duck
      }
    } else if (mode === 'piano') {
      const h = lastHit(P.pianoSteps, stepIdx, tStep, 10)
      if (h) {
        const [dt] = h
        const idx = Math.floor((barIdx * 16 + stepIdx % 16) / 2) % 8
        const note = notes[[0, 1, 2, 3, 2, 1, 3, 2][idx]] + 12 + melodyLift * (idx === 6 ? 1 : 0)
        const f = mtof(note)
        const pv = osc('tri', f * t) * 0.16 + osc('sine', f * 2 * t) * 0.05 * Math.exp(-dt * 5) + osc('sine', f * 3 * t) * 0.02 * Math.exp(-dt * 8)
        s += pv * Math.exp(-dt * 2.3) * Math.min(1, dt * 400)
      }
    }

    // --- arpeggio / lead
    if (P.arpDiv) {
      const step = beat / P.arpDiv
      const sIdx = Math.floor(tb / step)
      const st = tb - sIdx * step
      const note = notes[arpPat[sIdx % arpPat.length]] + 12 + melodyLift
      const f = mtof(note)
      const w = P.arpWave === 'saw' ? 2 * ((f * t) % 1) - 1 : osc(P.arpWave, f * t)
      s += P.arpGain * w * Math.exp(-st * 8) * Math.min(1, st * 400) * duck
    }

    // --- cinematic colour: bells on chord arrival, a riser every 8 bars, one deep hit at its end
    if (P.bells) {
      const bt = tb
      const f = mtof(notes[2] + 24)
      s += 0.07 * (osc('sine', f * t) + 0.5 * osc('sine', f * 2.76 * t)) * Math.exp(-bt * 1.1)
    }
    if (P.riser) {
      const cyc = bar * 8
      const rt = t % cyc
      const rs = cyc - bar * 2
      if (rt > rs) {
        const prog = (rt - rs) / (bar * 2)
        riserLP += (0.02 + 0.5 * prog * prog) * (nz() - riserLP)
        s += 0.35 * riserLP * prog
      } else if (rt < 0.8 && t > 1) {
        s += 0.5 * Math.sin(2 * Math.PI * (40 + 30 * Math.exp(-rt * 6)) * rt) * Math.exp(-rt * 3.2)
      }
    }

    // --- vinyl / room noise
    if (P.vinyl) {
      vinylLP += 0.4 * (nz() - vinylLP)
      s += P.vinyl * (nz() - vinylLP) * 0.6 + (noiseRnd() < 0.0004 ? P.vinyl * 4 * nz() : 0)
    }

    // --- echo, then a gentle low-pass so nothing is harsh
    if (delayBuf) {
      const d = delayBuf[delayIdx]
      delayBuf[delayIdx] = s + d * 0.4
      delayIdx = (delayIdx + 1) % dl
      s += d * P.echo
    }
    lpState += lpA * (s - lpState)
    buf[i] = Math.tanh(lpState * 1.1)
  }
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

console.log(JSON.stringify({ out, seed, style, duration, bpm: style === 'ambient' ? bpm : Math.round(60 / beat), rootMidi: root, scale: scaleName, progression: prog, pulse }))
