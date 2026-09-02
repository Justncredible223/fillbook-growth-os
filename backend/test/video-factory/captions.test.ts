import { describe, it, expect } from "vitest";
import { parseSrt, buildCaptionCues, secondsToAssTime, escapeAssText, buildAssFile } from "../../scripts/video-factory/captions";

const SAMPLE_SRT = `1
00:00:00,050 --> 00:00:03,500
Your funded account can get pulled even on a winning trade.

2
00:00:03,500 --> 00:00:06,637
Here is why trailing drawdown catches people off guard.

3
00:00:06,637 --> 00:00:08,662
Fillbook tracks it automatically.
`;

describe("parseSrt", () => {
  it("parses real edge-tts SRT output into cues with second-precision timing", () => {
    const cues = parseSrt(SAMPLE_SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({
      index: 1,
      startSeconds: 0.05,
      endSeconds: 3.5,
      text: "Your funded account can get pulled even on a winning trade.",
    });
    expect(cues[2]!.text).toBe("Fillbook tracks it automatically.");
  });

  it("handles CRLF line endings", () => {
    const cues = parseSrt(SAMPLE_SRT.replace(/\n/g, "\r\n"));
    expect(cues).toHaveLength(3);
  });

  it("returns an empty array for empty input", () => {
    expect(parseSrt("")).toEqual([]);
  });

  it("skips malformed blocks without throwing", () => {
    const malformed = "1\nnot a time range\ntext\n\n2\n00:00:01,000 --> 00:00:02,000\nreal cue\n";
    const cues = parseSrt(malformed);
    expect(cues).toHaveLength(1);
    expect(cues[0]!.text).toBe("real cue");
  });
});

describe("buildCaptionCues", () => {
  it("tags the first cue as Hook and the rest as Caption", () => {
    const cues = buildCaptionCues(parseSrt(SAMPLE_SRT));
    expect(cues[0]!.style).toBe("Hook");
    expect(cues[1]!.style).toBe("Caption");
    expect(cues[2]!.style).toBe("Caption");
  });

  it("passes short cues through untouched (real timing preserved)", () => {
    const cues = buildCaptionCues(parseSrt(SAMPLE_SRT));
    expect(cues).toHaveLength(3);
    expect(cues[1]!.startSeconds).toBeCloseTo(3.5, 5);
    expect(cues[1]!.endSeconds).toBeCloseTo(6.637, 5);
  });

  it("splits an oversized cue into multiple readable segments, proportionally timed within its real window", () => {
    const longCue = [
      "1",
      "00:00:00,000 --> 00:00:10,000",
      "This is a genuinely long sentence that goes on for quite a while, with multiple clauses, describing something in a lot of unnecessary detail for a caption.",
      "",
    ].join("\n");
    const cues = buildCaptionCues(parseSrt(longCue));
    expect(cues.length).toBeGreaterThan(1);
    // Segments should tile the original cue's time window exactly, in order.
    expect(cues[0]!.startSeconds).toBe(0);
    expect(cues[cues.length - 1]!.endSeconds).toBeCloseTo(10, 5);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.startSeconds).toBeCloseTo(cues[i - 1]!.endSeconds, 5);
    }
    // No single caption should be a huge wall of text.
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(70);
    }
  });

  it("returns an empty list for no cues", () => {
    expect(buildCaptionCues([])).toEqual([]);
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
  });

  it("emits one Dialogue line per caption cue with correct style and escaped text", () => {
    const ass = buildAssFile(
      [{ text: "The hook {line}", startSeconds: 0, endSeconds: 2, style: "Hook" }],
      [],
    );
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Hook,,0,0,0,,The hook line");
  });

  it("emits scene label dialogue on a separate layer from captions", () => {
    const ass = buildAssFile(
      [{ text: "caption", startSeconds: 0, endSeconds: 2, style: "Caption" }],
      [{ label: "FILLBOOK", startSeconds: 0, endSeconds: 2 }],
    );
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:02.00,SceneLabel,,0,0,0,,FILLBOOK");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,caption");
  });
});
