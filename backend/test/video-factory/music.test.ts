import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { listMusicTracks, pickMusic } from "../../scripts/video-factory/music";
import type { ProcessRunner } from "../../scripts/video-factory/processRunner";

const runnerWithDuration = (seconds: number): ProcessRunner => ({
  run: vi.fn().mockResolvedValue({ stdout: JSON.stringify({ streams: [], format: { duration: String(seconds) } }), stderr: "", exitCode: 0 }),
});

describe("listMusicTracks", () => {
  it("returns only .mp3 files, sorted, from the given directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "music-test-"));
    try {
      for (const f of ["b.mp3", "a.MP3", "LICENSE.txt", "c.wav"]) writeFileSync(join(dir, f), "x");
      expect(listMusicTracks(dir).map((p) => basename(p))).toEqual(["a.MP3", "b.mp3"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list for a missing directory, and the bundled dir has at least the default track", () => {
    expect(listMusicTracks(join(tmpdir(), "definitely-missing-dir"))).toEqual([]);
    expect(listMusicTracks().length).toBeGreaterThan(0);
  });
});

describe("the bundled music", () => {
  it("is a pool of in-house synthesised beds only (no third-party audio that platforms can flag), enough to rotate through", () => {
    const tracks = listMusicTracks().map((p) => basename(p));
    expect(tracks.length).toBeGreaterThanOrEqual(24);
    expect(tracks.every((t) => /^generated-bed-\d+\.mp3$/.test(t)), tracks.join(", ")).toBe(true);
  });
});

describe("makeMusicTrack styles", () => {
  const script = join(__dirname, "..", "..", "scripts", "video-factory", "makeMusicTrack.mjs");
  const styles = ["ambient", "lofi", "drive", "piano", "corporate", "synthwave", "deephouse", "cinematic"];

  it("every style renders audible, unclipped, finite audio, and the styles differ from one another", () => {
    const dir = mkdtempSync(join(tmpdir(), "music-styles-"));
    try {
      const rms: number[] = [];
      for (const style of styles) {
        const out = join(dir, `${style}.wav`);
        const info = JSON.parse(execFileSync("node", [script, "--seed", "test-seed", "--style", style, "--duration", "6", "--out", out], { encoding: "utf-8" }));
        expect(info.style).toBe(style);
        const wav = readFileSync(out);
        const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) / 2);
        let sum = 0;
        let peak = 0;
        for (const v of samples) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
        const r = Math.sqrt(sum / samples.length) / 32768;
        expect(r, `${style} is audible`).toBeGreaterThan(0.02);
        expect(peak, `${style} does not clip`).toBeLessThan(32767);
        rms.push(r);
      }
      expect(new Set(rms.map((v) => v.toFixed(3))).size, "styles do not all sound alike").toBeGreaterThanOrEqual(6);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses an unknown style", () => {
    expect(() => execFileSync("node", [script, "--style", "polka", "--duration", "1", "--out", join(tmpdir(), "x.wav")], { stdio: "pipe" })).toThrow();
  });
});

describe("pickMusic rotation", () => {
  it("walks through every track in order before any repeats, then loops back", async () => {
    const runner = runnerWithDuration(140);
    const tracks = ["/m/a.mp3", "/m/b.mp3", "/m/c.mp3", "/m/d.mp3", "/m/e.mp3"];
    const used: string[] = [];
    // The seed (a render id) is deliberately unrelated to the order: only the rotation index decides the track.
    for (let i = 0; i < 12; i++) used.push((await pickMusic(i * 7919 + 3, 18, runner, tracks, i))!.file);
    expect(new Set(used.slice(0, 5)).size).toBe(5);
    expect(used.slice(5, 10)).toEqual(used.slice(0, 5));
    expect(used[10]).toBe(used[0]);
    for (let i = 1; i < used.length; i++) expect(used[i]).not.toBe(used[i - 1]);
  });

  it("uses all bundled tracks across consecutive renders", async () => {
    const runner = runnerWithDuration(140);
    const tracks = listMusicTracks();
    const used = new Set<string>();
    for (let i = 0; i < tracks.length; i++) used.add((await pickMusic(1, 18, runner, tracks, i))!.file);
    expect(used.size).toBe(tracks.length);
  });
});

describe("pickMusic", () => {
  it("returns null with no tracks", async () => {
    expect(await pickMusic(1, 25, runnerWithDuration(140), [])).toBeNull();
  });

  it("is deterministic and keeps the whole segment inside the track", async () => {
    const runner = runnerWithDuration(140);
    for (const seed of [0, 1, 7, 123456, 4294967295]) {
      const a = await pickMusic(seed, 25, runner, ["/m/only.mp3"]);
      const b = await pickMusic(seed, 25, runner, ["/m/only.mp3"]);
      expect(a).toEqual(b);
      expect(a!.startSeconds).toBeGreaterThanOrEqual(0);
      expect(a!.startSeconds + 25).toBeLessThanOrEqual(140 - 1 + 1e-9);
    }
  });

  it("uses different stretches of the same track for different seeds", async () => {
    const runner = runnerWithDuration(140);
    const starts = new Set<number>();
    for (let seed = 0; seed < 20; seed++) starts.add((await pickMusic(seed, 25, runner, ["/m/only.mp3"]))!.startSeconds);
    expect(starts.size).toBeGreaterThan(5);
  });

  it("rotates across tracks by seed", async () => {
    const runner = runnerWithDuration(140);
    const files = new Set<string>();
    for (let seed = 0; seed < 6; seed++) files.add((await pickMusic(seed, 25, runner, ["/m/a.mp3", "/m/b.mp3", "/m/c.mp3"]))!.file);
    expect(files.size).toBe(3);
  });

  it("starts at 0 when the track is barely longer than the video", async () => {
    expect(await pickMusic(5, 25, runnerWithDuration(26), ["/m/short.mp3"])).toEqual({ file: "/m/short.mp3", startSeconds: 0 });
  });
});
