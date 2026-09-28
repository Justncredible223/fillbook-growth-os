/**
 * Child-process entry point for characters.ts's renderCharacterTrackIsolated: draws the whole character track and
 * exits, so the ~1 GB that @resvg/resvg-js's render() keeps allocated (see issue #54) goes back to the OS the moment
 * this process ends instead of staying resident in the render worker for the rest of the render.
 *
 *   node --import tsx renderCharacterTrackChild.ts <job.json>
 *
 * job.json: { beats, durationSeconds, outDir, pairId }. Prints one JSON line: { frameCount, peakRssMb }.
 */
import { readFileSync } from "node:fs";
import { renderCharacterTrack, type TimedBeat } from "./characters.js";
import type { CharacterPairId } from "../../src/shortform/types.js";

interface TrackJob {
  beats: TimedBeat[];
  durationSeconds: number;
  outDir: string;
  pairId?: CharacterPairId;
}

const jobPath = process.argv[2];
if (!jobPath) {
  console.error("usage: renderCharacterTrackChild.ts <job.json>");
  process.exit(2);
}
const job = JSON.parse(readFileSync(jobPath, "utf8")) as TrackJob;
const track = renderCharacterTrack(job.beats, job.durationSeconds, job.outDir, job.pairId);
// resourceUsage().maxRSS is in KB.
process.stdout.write(`${JSON.stringify({ frameCount: track.frameCount, peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024) })}\n`);
// Exit explicitly: nothing left to wait for, and the native allocations are released by the OS on exit.
process.exit(0);
