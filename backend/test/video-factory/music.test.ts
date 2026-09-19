import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
