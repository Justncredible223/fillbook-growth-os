import { describe, expect, it } from "vitest";
import { beatAt, buildStageSvg, talkSeconds, wrapQuip, type TimedBeat } from "../../scripts/video-factory/characters.js";
import { CHARACTER_STAGE_TOP, buildFfmpegArgs, computeCardLayout, assertCardClearsOverlays } from "../../scripts/video-factory/render.js";
import { CHARACTER_BEATS, CHARACTER_QUIP_MAX_CHARS, basePlanId } from "../../src/shortform/characterBeats.js";
import { PILOTS } from "../../src/shortform/pilots.js";
import { computeScenePlanHash, loadManifest, validateScenePlan } from "../../src/shortform/scenePlan.js";

const beats: TimedBeat[] = [
  { startSeconds: 0, endSeconds: 3, beat: { speaker: "tilt", quip: "Moving my stop is free, right?", rook: "shock", tilt: "shrug" } },
  { startSeconds: 3, endSeconds: 7, beat: { speaker: "rook", quip: "It has a price tag. Look.", rook: "point", tilt: "shock" } },
];

describe("character beats", () => {
  it("every concept, base or angle, carries one beat per scene", () => {
    for (const plan of PILOTS) {
      expect(CHARACTER_BEATS[basePlanId(plan.planId)], plan.planId).toBeDefined();
      for (const s of plan.scenes) expect(s.character, s.sceneId).toBeDefined();
    }
  });

  it("no quip carries a figure or overflows the bubble", () => {
    for (const list of Object.values(CHARACTER_BEATS)) {
      for (const b of list) {
        expect(b.quip).not.toMatch(/[0-9$%]/);
        expect(b.quip.length).toBeLessThanOrEqual(CHARACTER_QUIP_MAX_CHARS);
        expect(wrapQuip(b.quip).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("validateScenePlan rejects a quip with a number in it", () => {
    const plan = PILOTS[0]!;
    const bad = { ...plan, scenes: plan.scenes.map((s, i) => (i === 0 ? { ...s, character: { ...s.character!, quip: "Up $500 today!" } } : s)) };
    const codes = validateScenePlan(bad, loadManifest()).issues.map((i) => i.code);
    expect(codes).toContain("character_quip_has_figure");
  });

  it("rewording a quip does not change the plan hash approved scripts are checked against", () => {
    const plan = PILOTS[0]!;
    const reworded = { ...plan, scenes: plan.scenes.map((s) => ({ ...s, character: { ...s.character!, quip: "Different line." } })) };
    expect(computeScenePlanHash(reworded)).toBe(computeScenePlanHash(plan));
  });
});

describe("stage animation", () => {
  it("holds the last beat through the silence pad", () => {
    expect(beatAt(beats, 1)?.beat.speaker).toBe("tilt");
    expect(beatAt(beats, 5)?.beat.speaker).toBe("rook");
    expect(beatAt(beats, 7.5)?.beat.speaker).toBe("rook");
  });

  it("wraps between words into at most two lines", () => {
    expect(wrapQuip("Moving my stop is free, right?")).toEqual(["Moving my stop is", "free, right?"]);
    expect(wrapQuip("Pass? Obviously!")).toEqual(["Pass? Obviously!"]);
  });

  it("shows no bubble before it pops in, then the speaker's line", () => {
    expect(buildStageSvg(beats, 3.05)).not.toContain("It has a price tag.");
    expect(buildStageSvg(beats, 4)).toContain("It has a price tag.");
  });

  it("keeps the closing line up after the last scene ends", () => {
    expect(buildStageSvg(beats, 9)).toContain("It has a price tag.");
    expect(buildStageSvg(beats, 2.95)).toContain('opacity="0.417"');
  });

  it("moves the speaker's mouth only while they talk", () => {
    const talking = buildStageSvg(beats, 3 + 0.3 + 0.1);
    const after = buildStageSvg(beats, 3 + 0.3 + talkSeconds(beats[1]!.beat.quip) + 0.2);
    expect(talking).toContain("#E0566B"); // the talk mouth's tongue
    expect(after).not.toContain('rx="10" ry=');
  });
});

describe("render wiring", () => {
  it("the tallest verified card and its text still end above the stage", () => {
    const layout = computeCardLayout(1004, 957);
    expect(() => assertCardClearsOverlays(layout)).not.toThrow();
    expect(layout.textTop + 260).toBeLessThanOrEqual(CHARACTER_STAGE_TOP);
  });

  it("overlays the frame sequence at the stage, under the captions", () => {
    const args = buildFfmpegArgs({
      scenes: [{ kind: "explanation", label: "", durationSeconds: 3, backgroundColor: "0x05070a" }],
      totalDurationSeconds: 3,
      voiceoverPath: "vo.mp3",
      assPath: "captions.ass",
      outputPath: "final.mp4",
      silencePadSeconds: 0.3,
      characterTrack: { framePattern: "characters/f%05d.png", frameCount: 99 },
    });
    expect(args).toContain("characters/f%05d.png");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(`overlay=0:${CHARACTER_STAGE_TOP}:eof_action=pass`);
    expect(graph.indexOf("[chars]subtitles=")).toBeGreaterThan(graph.indexOf(`overlay=0:${CHARACTER_STAGE_TOP}`));
  });
});
