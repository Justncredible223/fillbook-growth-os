import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import { runFfprobeJson } from "./validate.js";

const MUSIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "assets", "music");

export interface MusicChoice {
  /** Absolute path of the chosen track in the bundled assets dir. */
  file: string;
  /** Where in the track this render's bed starts, so different renders use different stretches of it. */
  startSeconds: number;
}

/** Sorted so a given seed always maps to the same track. Any .mp3 dropped into assets/music/ is picked up automatically. */
export function listMusicTracks(dir: string = MUSIC_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Keep this much slack past the end of the segment so it never runs off the track (which would loop mid-video). */
const END_SLACK_SECONDS = 1;

/**
 * Chooses the track and start offset for one render, deterministically from
 * `seed`: the track is `seed` mod the number of bundled tracks, and the
 * start offset is a seeded point in the track that still leaves room for
 * the whole video. With a single 2:20 track and ~25s videos this already
 * gives ~5 distinct, non-overlapping stretches; every extra track multiplies
 * that. Returns null when there are no bundled tracks (the caller then
 * keeps the renderer's default bed).
 */
export async function pickMusic(
  seed: number,
  totalDurationSeconds: number,
  runner: ProcessRunner,
  tracks: string[] = listMusicTracks(),
): Promise<MusicChoice | null> {
  if (tracks.length === 0) return null;
  const file = tracks[seed % tracks.length]!;
  const probe = await runFfprobeJson(file, runner);
  const trackSeconds = Number(probe.format.duration);
  const room = trackSeconds - totalDurationSeconds - END_SLACK_SECONDS;
  if (!Number.isFinite(room) || room <= 0) return { file, startSeconds: 0 };
  // A second, independent hash of the seed so track choice and offset aren't correlated.
  const fraction = ((Math.floor(seed / tracks.length) * 2654435761) % 1000) / 1000;
  return { file, startSeconds: Math.round(fraction * room * 10) / 10 };
}
