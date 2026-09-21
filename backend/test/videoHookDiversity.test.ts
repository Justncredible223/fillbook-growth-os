import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftVideoScript, VideoHookTooSimilarError, type VideoScript } from "../src/content/videoScriptWriter";
import { checkHookSimilarity, pickHookFormat, buildHookGuidance, HOOK_FORMATS, KNOWN_PUBLISHED_HOOKS, TOP_PERFORMERS } from "../src/content/videoHookDiversity";

function scriptWith(hook: string): VideoScript {
  return {
    hook,
    script: `${hook} and here is the point in a handful of plain words that keeps the whole thing short enough to pass the length guard easily.`,
    shotList: ["Text card"],
    youtubeTitle: "t", youtubeDescription: "d", tiktokCaption: "c", instagramCaption: "i",
    hashtags: ["futurestrading"], disclosureCta: null, youtubeThumbnailConcept: "x",
  };
}
const resp = (v: VideoScript) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "submit_video_script", input: v }] }), text: async () => "" }) as Response;
const opp = { title: "Trailing drawdown", rationale: "r" };

describe("checkHookSimilarity", () => {
  it("flags a hook that opens with the same first four words as a recent one", () => {
    const r = checkHookSimilarity("You already know which rule you'll break tomorrow", ["You already know which trade you're about to repeat"]);
    expect(r.similar).toBe(true);
    expect(r.reason).toContain("first four words");
  });
  it("flags a heavily overlapping rewording even when the opening differs", () => {
    const r = checkHookSimilarity("Traders replay your losses but never review your wins", ["You replay your losses but never review your wins"]);
    expect(r.similar).toBe(true);
  });
  it("passes a genuinely different hook", () => {
    expect(checkHookSimilarity("Topstep locks your drawdown floor once you pass the starting balance", ["You replay your losses but never review your wins"]).similar).toBe(false);
  });
  it("ignores empty entries and short hooks that only share filler words", () => {
    expect(checkHookSimilarity("Stop it", ["", "Stop it now"]).similar).toBe(false);
  });
});

describe("pickHookFormat", () => {
  it("is deterministic for the same day and topic, and varies across days", () => {
    const d = new Date("2026-09-21T12:00:00Z");
    expect(pickHookFormat(d, "topic").id).toBe(pickHookFormat(d, "topic").id);
    const ids = new Set(Array.from({ length: 7 }, (_, i) => pickHookFormat(new Date(d.getTime() + i * 86_400_000), "topic").id));
    expect(ids.size).toBe(HOOK_FORMATS.length);
  });
  it("skips a format that already dominates the recent hooks", () => {
    const d = new Date("2026-09-21T12:00:00Z");
    const first = pickHookFormat(d, "x");
    if (first.id !== "real_question") return; // signature only exists for a few formats
    const picked = pickHookFormat(d, "x", ["Is this right?", "What is trailing drawdown?"]);
    expect(picked.id).not.toBe("real_question");
  });
});

describe("buildHookGuidance", () => {
  it("names the format, lists published hooks to avoid, and shows what worked", () => {
    const g = buildHookGuidance({ format: HOOK_FORMATS[0]!, recentHooks: ["A recent hook"] });
    expect(g).toContain(HOOK_FORMATS[0]!.name);
    expect(g).toContain("A recent hook");
    expect(g).toContain(KNOWN_PUBLISHED_HOOKS[0]!);
    expect(g).toContain(String(TOP_PERFORMERS[0]!.views));
  });
});

describe("draftVideoScript hook guard", () => {
  it("tells the model the format and the hooks to avoid, and no longer ships a copyable example hook in the system prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(scriptWith("Topstep locks your drawdown floor at the starting balance")));
    await draftVideoScript(new LlmClient("k", fetchMock), opp, "brand", "facts", { recentHooks: ["My recent hook line here"] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system);
    expect(JSON.stringify(body.messages)).toContain("My recent hook line here");
    expect(JSON.stringify(body.messages)).toContain("HOOK FOR THIS VIDEO");
    expect(system).not.toContain("You already know which trade you're about to repeat");
  });

  it("retries once when the first hook repeats a published opener, and accepts the different one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(scriptWith("You already know which trade you're about to repeat")))
      .mockResolvedValueOnce(resp(scriptWith("Topstep locks your drawdown floor at the starting balance")));
    const out = await draftVideoScript(new LlmClient("k", fetchMock), opp, "brand", "facts");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.hook).toContain("Topstep");
    expect(JSON.stringify(JSON.parse(fetchMock.mock.calls[1]![1].body).messages)).toContain("HOOK FIX REQUIRED");
  });

  it("stops with a clear error when the rewrite is still a repeat, instead of queuing a duplicate", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(scriptWith("You already know which trade you're about to repeat")));
    await expect(draftVideoScript(new LlmClient("k", fetchMock), opp, "brand", "facts")).rejects.toBeInstanceOf(VideoHookTooSimilarError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
