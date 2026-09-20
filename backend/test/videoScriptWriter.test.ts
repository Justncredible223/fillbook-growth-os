import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import {
  draftVideoScript,
  formatVideoScriptAsText,
  countSpokenWords,
  MAX_SCRIPT_WORDS,
  VideoScriptTooLongError,
  VideoHookRepeatError,
  MAX_HOOK_REWRITES,
  type VideoScript,
} from "../src/content/videoScriptWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function scriptResponse(input: VideoScript) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_video_script", input }] });
}

const opportunity = {
  title: "Traders confused about trailing drawdown",
  rationale: "High audience relevance, strong Fillbook fit.",
};

describe("draftVideoScript", () => {
  it("returns the structured video script from the tool call", async () => {
    const script: VideoScript = {
      hook: "Your funded account can get pulled even on a winning trade.",
      script: "Your funded account can get pulled even on a winning trade. Here's why trailing drawdown catches people off guard...",
      shotList: ["Text card: the hook line", "Fillbook UI: example drawdown chart (demo data)"],
      youtubeTitle: "Why Your Funded Account Gets Pulled Even When You're Winning",
      youtubeDescription: "Trailing drawdown catches even profitable traders off guard -- here's what to watch for.",
      tiktokCaption: "Trailing drawdown explained in 30 seconds.",
      instagramCaption: "Trailing drawdown explained -- and why it catches even winning trades.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: null,
      youtubeThumbnailConcept: "Bold text 'STILL LOSING?' over a split-screen of a green trade and a drawdown alert.",
    };
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(script));
    const client = new LlmClient("test-key", fetchMock);

    const result = await draftVideoScript(client, opportunity, "voice: concise", "Fillbook tracks prop-firm drawdown rules.");

    expect(result).toEqual(script);
    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_video_script" });
  });
});

describe("draftVideoScript length guard", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const withScript = (script: string): VideoScript => ({
    hook: "The hook.",
    script,
    shotList: ["Text card: the hook line"],
    youtubeTitle: "t",
    youtubeDescription: "d",
    tiktokCaption: "c",
    instagramCaption: "i",
    hashtags: ["futurestrading"],
    disclosureCta: null,
    youtubeThumbnailConcept: "x",
  });
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
    JSON.parse((fetchMock.mock.calls[call]![1] as { body: string }).body) as { messages: Array<{ content: string }> };

  it("makes a single call when the script is within the cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(withScript(words(MAX_SCRIPT_WORDS))));
    const result = await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(countSpokenWords(result.script)).toBe(MAX_SCRIPT_WORDS);
  });

  it("sends an over-long script back once with its exact word count, and returns the shorter rewrite", async () => {
    const long = words(93);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(scriptResponse(withScript(long)))
      .mockResolvedValueOnce(scriptResponse(withScript(words(70))));
    const result = await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryText = JSON.stringify(bodyOf(fetchMock, 1));
    expect(retryText).toContain("LENGTH FIX REQUIRED");
    expect(retryText).toContain("was 93 words");
    expect(retryText).toContain(long);
    expect(countSpokenWords(result.script)).toBe(70);
  });

  it("throws VideoScriptTooLongError (no third attempt) when the rewrite is still over the cap", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(withScript(words(95))));
    const attempt = draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts");
    await expect(attempt).rejects.toBeInstanceOf(VideoScriptTooLongError);
    await expect(attempt).rejects.toThrow(/95 words/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("draftVideoScript hook variety", () => {
  const scriptWith = (hook: string): VideoScript => ({
    hook,
    script: Array.from({ length: 60 }, (_, i) => `word${i}`).join(" "),
    shotList: ["Text card: the hook line"],
    youtubeTitle: "t",
    youtubeDescription: "d",
    tiktokCaption: "c",
    instagramCaption: "i",
    hashtags: ["futurestrading"],
    disclosureCta: null,
    youtubeThumbnailConcept: "x",
  });
  const recentVideos = [{ hook: "You already know which trade you're about to repeat.", title: "Trade review" }];
  const bodyText = (fetchMock: ReturnType<typeof vi.fn>, call: number) => (fetchMock.mock.calls[call]![1] as { body: string }).body;

  it("shows the recent hooks to the writer and makes one call when the hook is fresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(scriptWith("Your loss limit doesn't care that the trade was good.")));
    await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts", recentVideos);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyText(fetchMock, 0)).toContain("RECENT VIDEOS");
    expect(bodyText(fetchMock, 0)).toContain("You already know which trade you're about to repeat.");
  });

  it("sends a repeated hook back with the hook it repeats, and returns the fresh rewrite", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(scriptResponse(scriptWith("You already know which trade you're about to blow up.")))
      .mockResolvedValueOnce(scriptResponse(scriptWith("Copy-trading five accounts means one mistake gets made five times.")));
    const result = await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts", recentVideos);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodyText(fetchMock, 1)).toContain("HOOK REPEATS A RECENT VIDEO");
    expect(bodyText(fetchMock, 1)).toContain("You already know which trade you're about to repeat.");
    expect(result.hook).toContain("Copy-trading");
  });

  it("throws VideoHookRepeatError after MAX_HOOK_REWRITES rewrites instead of returning a repeat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(scriptWith("You already know which trade you're about to blow up.")));
    const attempt = draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts", recentVideos);
    await expect(attempt).rejects.toBeInstanceOf(VideoHookRepeatError);
    expect(fetchMock).toHaveBeenCalledTimes(1 + MAX_HOOK_REWRITES);
  });

  it("does no hook checking and adds no history section when there are no recent videos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(scriptWith("You already know which trade you're about to repeat.")));
    await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyText(fetchMock, 0)).not.toContain("RECENT VIDEOS (already published");
  });

  it("the system prompt no longer teaches the repeated hook as its own example", async () => {
    const fetchMock = vi.fn().mockResolvedValue(scriptResponse(scriptWith("Something else entirely.")));
    await draftVideoScript(new LlmClient("k", fetchMock), opportunity, "voice", "facts");
    const body = JSON.parse(bodyText(fetchMock, 0)) as { system: unknown };
    expect(JSON.stringify(body.system)).not.toContain("You already know which trade you're about to repeat");
  });
});

describe("countSpokenWords", () => {
  it("counts words, ignoring stray punctuation-only tokens", () => {
    expect(countSpokenWords("You already know -- which trade & you're about to repeat.")).toBe(9);
    expect(countSpokenWords("  ")).toBe(0);
    expect(countSpokenWords("Fillbook imports 107 trades.")).toBe(4);
  });
});

describe("formatVideoScriptAsText", () => {
  it("flattens the script into one readable, numbered text block, with all platform-specific metadata distinct from each other", () => {
    const script: VideoScript = {
      hook: "The hook line.",
      script: "The full spoken script.",
      shotList: ["First shot", "Second shot"],
      youtubeTitle: "The YouTube title.",
      youtubeDescription: "The YouTube description.",
      tiktokCaption: "The TikTok caption.",
      instagramCaption: "The Instagram caption.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
      youtubeThumbnailConcept: "Bold text overlay over a split-screen visual.",
    };

    const text = formatVideoScriptAsText(script);

    expect(text).toContain("HOOK: The hook line.");
    expect(text).toContain("1. First shot");
    expect(text).toContain("2. Second shot");
    expect(text).toContain("YOUTUBE TITLE:\nThe YouTube title.");
    expect(text).toContain("YOUTUBE DESCRIPTION:\nThe YouTube description.");
    expect(text).toContain("TIKTOK CAPTION:\nThe TikTok caption.");
    expect(text).toContain("INSTAGRAM CAPTION:\nThe Instagram caption.");
    expect(text).toContain("HASHTAGS: #futurestrading #propfirm");
    expect(text).toContain("DISCLOSURE/CTA: Example data shown for illustration only.");
  });

  it("omits the disclosure/CTA line entirely when null -- never fabricates a filler line", () => {
    const script: VideoScript = {
      hook: "The hook line.",
      script: "The full spoken script.",
      shotList: ["First shot"],
      youtubeTitle: "The YouTube title.",
      youtubeDescription: "The YouTube description.",
      tiktokCaption: "The TikTok caption.",
      instagramCaption: "The Instagram caption.",
      hashtags: ["futurestrading"],
      disclosureCta: null,
      youtubeThumbnailConcept: "Bold text overlay over a split-screen visual.",
    };

    const text = formatVideoScriptAsText(script);

    expect(text).not.toContain("DISCLOSURE/CTA");
  });
});
