import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCharacterTrack, renderCharacterTrackIsolated, type TimedBeat } from "../../scripts/video-factory/characters";
import { PILOTS } from "../../src/shortform/pilots";

// A real plan's real beats, drawn for one second (30 frames) so each spawn stays quick.
const plan = PILOTS.find((p) => p.planId === "pilot-3-same-setup-bigger-size")!;
const beats: TimedBeat[] = [];
{
  let t = 0;
  for (const s of plan.scenes) {
    if (s.character) beats.push({ startSeconds: t, endSeconds: t + s.durationSeconds, beat: s.character });
    t += s.durationSeconds;
  }
}
const SECONDS = 1;
const slow = 90_000; // a child starts a whole tsx process

const fingerprint = (outDir: string): string[] => {
  const dir = join(outDir, "characters");
  return readdirSync(dir).sort().map((f) => `${f}:${createHash("md5").update(readFileSync(join(dir, f))).digest("hex")}`);
};
const fresh = () => mkdtempSync(join(tmpdir(), "chartrack-"));

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CHARACTER_TRACK_IN_PROCESS;
});

describe("renderCharacterTrackIsolated", () => {
  it("draws byte-identical frames to renderCharacterTrack, and the child cleans up after itself", { timeout: slow }, async () => {
    const inProcessDir = fresh();
    const isolatedDir = fresh();
    const expected = renderCharacterTrack(beats, SECONDS, inProcessDir, plan.characterPairId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const actual = await renderCharacterTrackIsolated(beats, SECONDS, isolatedDir, plan.characterPairId);
    expect(warn, "the child must have worked; a fallback would hide a broken child").not.toHaveBeenCalled();
    expect(actual).toEqual(expected);
    expect(fingerprint(isolatedDir)).toEqual(fingerprint(inProcessDir));
    expect(existsSync(join(isolatedDir, "character-track-job.json"))).toBe(false);
  });

  it("falls back to drawing in-process, with identical frames and a warning, when the child cannot run", { timeout: slow }, async () => {
    const inProcessDir = fresh();
    const fallbackDir = fresh();
    const expected = renderCharacterTrack(beats, SECONDS, inProcessDir, plan.characterPairId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const actual = await renderCharacterTrackIsolated(beats, SECONDS, fallbackDir, plan.characterPairId, { childScript: join(tmpdir(), "no-such-child-script.ts") });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("drawing it in-process instead");
    expect(actual).toEqual(expected);
    expect(fingerprint(fallbackDir)).toEqual(fingerprint(inProcessDir));
    expect(existsSync(join(fallbackDir, "character-track-job.json"))).toBe(false);
  });

  it("CHARACTER_TRACK_IN_PROCESS=1 skips the child and draws the same frames", { timeout: slow }, async () => {
    const inProcessDir = fresh();
    const skipDir = fresh();
    renderCharacterTrack(beats, SECONDS, inProcessDir, plan.characterPairId);
    process.env.CHARACTER_TRACK_IN_PROCESS = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderCharacterTrackIsolated(beats, SECONDS, skipDir, plan.characterPairId, { childScript: join(tmpdir(), "would-fail-if-used.ts") });
    expect(warn, "a child would have failed here and warned, so no warning means none was started").not.toHaveBeenCalled();
    expect(fingerprint(skipDir)).toEqual(fingerprint(inProcessDir));
  });
});
