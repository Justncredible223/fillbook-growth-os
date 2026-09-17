import { describe, it, expect } from "vitest";
import {
  groupWordsIntoPhrases,
  buildWordHighlightCues,
  buildCaptionCues,
  buildOutroCue,
  mergeBrandNameWordCues,
  secondsToAssTime,
  escapeAssText,
  buildAssFile,
} from "../../scripts/video-factory/captions";
import type { WordCue } from "../../scripts/video-factory/types";

function word(text: string, startSeconds: number, endSeconds: number): WordCue {
  return { text, startSeconds, endSeconds };
}

describe("mergeBrandNameWordCues", () => {
  it("merges an adjacent Fill + book pair into one Fillbook cue spanning both", () => {
    const words = [word("Try", 0, 0.1), word("Fill", 0.15, 0.35), word("book", 0.35, 0.55), word("today.", 0.6, 0.9)];
    const merged = mergeBrandNameWordCues(words);
    expect(merged).toEqual([
      word("Try", 0, 0.1),
      { text: "Fillbook", startSeconds: 0.15, endSeconds: 0.55 },
      word("today.", 0.6, 0.9),
    ]);
  });

  it("matches case-insensitively and ignores trailing punctuation", () => {
    const words = [word("fill", 0, 0.2), word("book.", 0.2, 0.4)];
    expect(mergeBrandNameWordCues(words)).toEqual([{ text: "Fillbook", startSeconds: 0, endSeconds: 0.4 }]);
  });

  it("merges multiple separate occurrences", () => {
    const words = [word("Fill", 0, 0.2), word("book", 0.2, 0.4), word("and", 0.4, 0.5), word("Fill", 0.5, 0.7), word("book", 0.7, 0.9)];
    const merged = mergeBrandNameWordCues(words);
    expect(merged.map((w) => w.text)).toEqual(["Fillbook", "and", "Fillbook"]);
  });

  it("leaves words alone when Fill and book aren't adjacent", () => {
    const words = [word("Fill", 0, 0.2), word("your", 0.2, 0.4), word("book.", 0.4, 0.6)];
    expect(mergeBrandNameWordCues(words)).toEqual(words);
  });

  it("returns an empty list for no words", () => {
    expect(mergeBrandNameWordCues([])).toEqual([]);
  });
});

describe("groupWordsIntoPhrases", () => {
  it("keeps closely-spoken words in one phrase", () => {
    const words = [word("Your", 0, 0.2), word("funded", 0.22, 0.5), word("account.", 0.52, 0.9)];
    expect(groupWordsIntoPhrases(words)).toEqual([words]);
  });

  it("breaks a phrase at a natural pause (>= 0.35s gap)", () => {
    const words = [word("Your", 0, 0.2), word("account.", 0.25, 0.5), word("Here", 0.9, 1.1)];
    const phrases = groupWordsIntoPhrases(words);
    expect(phrases).toHaveLength(2);
    expect(phrases[0]!.map((w) => w.text)).toEqual(["Your", "account."]);
    expect(phrases[1]!.map((w) => w.text)).toEqual(["Here"]);
  });

  it("breaks a phrase once it exceeds the max word count, even with no pause", () => {
    const words = Array.from({ length: 8 }, (_, i) => word(`w${i}`, i * 0.1, i * 0.1 + 0.09));
    const phrases = groupWordsIntoPhrases(words);
    expect(phrases.length).toBeGreaterThan(1);
    expect(phrases[0]!.length).toBeLessThanOrEqual(6);
  });

  it("breaks a phrase once it exceeds the max character count", () => {
    const words = [
      word("supercalifragilisticexpialidocious", 0, 0.5),
      word("anotherlongword", 0.5, 1.0),
      word("short", 1.0, 1.2),
    ];
    const phrases = groupWordsIntoPhrases(words);
    expect(phrases.length).toBeGreaterThan(1);
  });

  it("returns an empty list for no words", () => {
    expect(groupWordsIntoPhrases([])).toEqual([]);
  });
});

describe("buildWordHighlightCues", () => {
  it("emits one cue per word, each highlighting only that word", () => {
    const phrase = [word("Your", 0, 0.3), word("funded", 0.35, 0.7), word("account.", 0.75, 1.0)];
    const cues = buildWordHighlightCues(phrase, "Caption");
    expect(cues).toHaveLength(3);
    expect(cues[0]!.text).toBe("{\\c&H00EED322&}Your{\\c&H00FFFFFF&} funded account.");
    expect(cues[1]!.text).toBe("Your {\\c&H00EED322&}funded{\\c&H00FFFFFF&} account.");
    expect(cues[2]!.text).toBe("Your funded {\\c&H00EED322&}account.{\\c&H00FFFFFF&}");
    expect(cues.every((c) => c.style === "Caption")).toBe(true);
  });

  it("extends each word's display window to the next word's start, avoiding flicker in natural gaps", () => {
    const phrase = [word("Your", 0, 0.2), word("account.", 0.3, 0.5)];
    const cues = buildWordHighlightCues(phrase, "Caption");
    expect(cues[0]!.startSeconds).toBe(0);
    expect(cues[0]!.endSeconds).toBe(0.3);
    expect(cues[1]!.startSeconds).toBe(0.3);
    expect(cues[1]!.endSeconds).toBe(0.5);
  });

  it("strips literal braces from word text before wrapping the active word", () => {
    const phrase = [word("50%", 0, 0.3), word("{risk}", 0.3, 0.6)];
    const cues = buildWordHighlightCues(phrase, "Caption");
    expect(cues[1]!.text).toBe("50% {\\c&H00EED322&}risk{\\c&H00FFFFFF&}");
  });
});

describe("buildCaptionCues", () => {
  it("tags the first phrase's cues as Hook and later phrases as Caption", () => {
    const words = [
      word("Your", 0, 0.2),
      word("account.", 0.25, 0.5),
      word("Here", 0.9, 1.1),
      word("it", 1.15, 1.3),
    ];
    const cues = buildCaptionCues(words);
    const firstPhraseCues = cues.filter((c) => c.startSeconds < 0.5);
    const restCues = cues.filter((c) => c.startSeconds >= 0.9);
    expect(firstPhraseCues.every((c) => c.style === "Hook")).toBe(true);
    expect(restCues.every((c) => c.style === "Caption")).toBe(true);
  });

  it("returns an empty list for no words", () => {
    expect(buildCaptionCues([])).toEqual([]);
  });
});

describe("buildOutroCue", () => {
  it("spans exactly the trailing silence pad window", () => {
    const cue = buildOutroCue(30, 2.5);
    expect(cue.startSeconds).toBe(27.5);
    expect(cue.endSeconds).toBe(30);
    expect(cue.style).toBe("Outro");
  });

  it("includes the brand name and URL on separate lines", () => {
    const cue = buildOutroCue(30, 2.5);
    expect(cue.text).toContain("FILLBOOK");
    expect(cue.text).toContain("fillbookhq.com");
    expect(cue.text).toContain("\\N");
  });

  it("never starts before zero even if the pad exceeds total duration", () => {
    const cue = buildOutroCue(1, 2.5);
    expect(cue.startSeconds).toBe(0);
  });
});

describe("secondsToAssTime", () => {
  it("formats sub-minute durations", () => {
    expect(secondsToAssTime(3.5)).toBe("0:00:03.50");
  });

  it("formats durations with minutes and hours", () => {
    expect(secondsToAssTime(65.25)).toBe("0:01:05.25");
    expect(secondsToAssTime(3661.1)).toBe("1:01:01.10");
  });

  it("formats zero", () => {
    expect(secondsToAssTime(0)).toBe("0:00:00.00");
  });
});

describe("escapeAssText", () => {
  it("strips literal braces that would open an ASS override block", () => {
    expect(escapeAssText("50% {risk} explained")).toBe("50% risk explained");
  });

  it("converts newlines to the ASS hard line break", () => {
    expect(escapeAssText("line one\nline two")).toBe("line one\\Nline two");
  });

  it("leaves normal text untouched", () => {
    expect(escapeAssText("Your funded account, explained.")).toBe("Your funded account, explained.");
  });
});

describe("buildAssFile", () => {
  it("includes the known-good header (PlayResX/PlayResY matching render resolution, Alignment=5)", () => {
    const ass = buildAssFile([], []);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Style: Hook,");
    expect(ass).toContain("Style: Caption,");
    expect(ass).toContain("Style: SceneLabel,");
    expect(ass).toContain("Style: Outro,");
  });

  it("emits one Dialogue line per caption cue with correct style, interpolating pre-formed text verbatim", () => {
    const ass = buildAssFile([{ text: "{\\c&H00EED322&}The{\\c&H00FFFFFF&} hook", startSeconds: 0, endSeconds: 2, style: "Hook" }], []);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Hook,,0,0,0,,{\\c&H00EED322&}The{\\c&H00FFFFFF&} hook");
  });

  it("emits scene label dialogue on a separate layer from captions, escaping the label text", () => {
    const ass = buildAssFile(
      [{ text: "caption", startSeconds: 0, endSeconds: 2, style: "Caption" }],
      [{ label: "FILLBOOK", startSeconds: 0, endSeconds: 2 }],
    );
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:02.00,SceneLabel,,0,0,0,,FILLBOOK");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,caption");
  });
});
