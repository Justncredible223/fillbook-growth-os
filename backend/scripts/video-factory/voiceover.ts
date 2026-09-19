import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessRunner } from "./processRunner.js";
import { VideoFactoryError } from "./types.js";
import type { WordCue } from "./types.js";

/**
 * Reverted from "en-US-AndrewMultilingualNeural" back to the original
 * "en-US-AndrewNeural" (2026-09-17) -- the Multilingual HD tier reads a
 * noticeably more natural/expressive cadence, but confirmed by ear on a
 * real render to mispronounce the plain word "book" with a long, foreign
 * "oo" (like the "oo" in "food") instead of the short vowel in "a book
 * you read." That looks like a real quirk of that voice's multilingual
 * phoneme handling specifically -- "book" is about as common an English
 * word as exists, so a standard (non-multilingual) neural voice reading
 * it correctly is the expected case, not a coincidence. Same free
 * edge-tts, no API key, no cloned/real-person voice identity per
 * ~/fillbookhq/docs/social/VIDEO_PRODUCTION_WORKFLOW.md's guardrail --
 * override only if you deliberately want voice variety (see
 * `edge-tts --list-voices` for other free options), and re-verify "book"
 * by ear before ever switching back to a Multilingual-tier voice.
 */
export const DEFAULT_VOICE = "en-US-AndrewNeural";

/**
 * Voice choice re-confirmed 2026-09-19: stay on the standard AndrewNeural.
 * It is the only voice verified by ear to say "book" (and so "Fillbook")
 * correctly; every Multilingual-tier voice (Andrew/Brian/Ava/Emma
 * Multilingual) shares the phoneme defect above and is ruled out for this
 * brand. Other standard voices (Christopher, Guy, Brian, ...) are untested
 * for "book" -- check it by ear before adopting one.
 *
 * The pace is what changed: edge-tts `rate` is relative to the voice's
 * default, so "+8%" reads a touch faster without changing pronunciation.
 * A brisker read holds attention and shortens the video (completion rate
 * is the strongest TikTok ranking signal). Set "+0%" for the old pace.
 */
export const DEFAULT_RATE = "+8%";

export interface VoiceoverResult {
  mp3Path: string;
  wordCues: WordCue[];
  durationSeconds: number;
}

const WORD_TIMING_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "edge_tts_words.py");

/**
 * edge-tts mispronounces "Fillbook" as a single compound word (confirmed
 * by ear on a real render -- it read as "fill-boo-k" instead of
 * "fill-book"). Splitting it into the two real dictionary words it's
 * actually made of before sending text to TTS fixes the compound-word
 * blending. (A separate issue -- the Multilingual voice tier
 * mispronouncing the word "book" itself -- turned out to be a voice
 * defect, not a spelling problem; fixed by switching DEFAULT_VOICE back
 * to the standard "en-US-AndrewNeural", not by respelling "book" into
 * something else. The word sent to TTS is the real word "book," spoken
 * as itself.) This only affects what's SPOKEN; captions.ts's
 * mergeBrandNameWordCues stitches the resulting two WordBoundary entries
 * back into one "Fillbook" caption word afterward, so it still displays
 * and highlights as a single word on screen, matching what it actually is.
 *
 * Also matches "FillbookHQ" (e.g. every script's closing "head to
 * fillbookhq.com" line) -- \bFillbook\b alone never matched it, since
 * there's no word boundary between the "k" and the "H" ("FillbookHQ" is
 * one unbroken run of letters), so that form was sent to TTS completely
 * unrespelled. The optional HQ group below is split out as its own word
 * the same way.
 */
export function respellFillbookForTts(text: string): string {
  return text.replace(/\bFillbook(HQ)?\b/gi, (match, hq: string | undefined) => {
    const isAllCaps = match === match.toUpperCase();
    const isCapitalized = match.charAt(0) === match.charAt(0).toUpperCase();
    const fill = isAllCaps ? "FILL" : isCapitalized ? "Fill" : "fill";
    const book = isAllCaps ? "BOOK" : "book";
    return hq ? `${fill} ${book} ${hq}` : `${fill} ${book}`;
  });
}

/**
 * Runs edge_tts_words.py against the approved script text, via a script
 * file (not inline text) so arbitrary punctuation/quotes never need
 * shell-escaping -- same reasoning as the old CLI-based `--file` flag.
 * Calls the edge_tts Python library directly (through this helper script)
 * rather than the edge-tts CLI, because only the library's WordBoundary
 * stream gives real per-word timing -- the CLI's --write-subtitles only
 * ever produced sentence-level SRT cues, not enough to drive word-by-word
 * highlighted captions (see captions.ts's buildWordHighlightCues).
 */
export async function generateVoiceover(
  scriptText: string,
  outDir: string,
  runner: ProcessRunner,
  voice: string = DEFAULT_VOICE,
  rate: string = DEFAULT_RATE,
): Promise<VoiceoverResult> {
  const scriptPath = join(outDir, "script.txt");
  const mp3Path = join(outDir, "voiceover.mp3");
  const wordsPath = join(outDir, "voiceover.words.json");
  writeFileSync(scriptPath, respellFillbookForTts(scriptText), "utf-8");

  const result = await runner.run("python3", [
    WORD_TIMING_SCRIPT,
    "--voice",
    voice,
    "--rate",
    rate,
    "--file",
    scriptPath,
    "--out-media",
    mp3Path,
    "--out-words",
    wordsPath,
  ]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`edge-tts word-timing script failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  let wordsContent: string;
  try {
    wordsContent = readFileSync(wordsPath, "utf-8");
  } catch (err) {
    throw new VideoFactoryError(
      `edge-tts word-timing script reported success but did not write word timings to "${wordsPath}": ${(err as Error).message}`,
    );
  }

  let wordCues: WordCue[];
  try {
    wordCues = JSON.parse(wordsContent) as WordCue[];
  } catch (err) {
    throw new VideoFactoryError(`edge-tts word-timing script wrote invalid JSON to "${wordsPath}": ${(err as Error).message}`);
  }
  if (wordCues.length === 0) {
    throw new VideoFactoryError("edge-tts produced no word timing data -- cannot time captions without it.");
  }

  const durationSeconds = await measureAudioDuration(mp3Path, runner);
  return { mp3Path, wordCues, durationSeconds };
}

/** ffprobe -show_format gives duration directly -- no need to decode the audio. */
export async function measureAudioDuration(mp3Path: string, runner: ProcessRunner): Promise<number> {
  const result = await runner.run("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", mp3Path]);
  if (result.exitCode !== 0) {
    throw new VideoFactoryError(`ffprobe failed to read "${mp3Path}" (exit ${result.exitCode}): ${result.stderr}`);
  }
  let parsed: { format?: { duration?: string } };
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new VideoFactoryError(`ffprobe returned non-JSON output for "${mp3Path}": ${(err as Error).message}`);
  }
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoFactoryError(`ffprobe returned an invalid duration for "${mp3Path}": ${parsed.format?.duration}`);
  }
  return duration;
}
