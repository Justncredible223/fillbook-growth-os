import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftVideoScript, formatVideoScriptAsText, type VideoScript } from "../src/content/videoScriptWriter";

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
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: null,
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

describe("formatVideoScriptAsText", () => {
  it("flattens the script into one readable, numbered text block, with all platform-specific metadata distinct from each other", () => {
    const script: VideoScript = {
      hook: "The hook line.",
      script: "The full spoken script.",
      shotList: ["First shot", "Second shot"],
      youtubeTitle: "The YouTube title.",
      youtubeDescription: "The YouTube description.",
      tiktokCaption: "The TikTok caption.",
      hashtags: ["futurestrading", "propfirm"],
      disclosureCta: "Example data shown for illustration only.",
    };

    const text = formatVideoScriptAsText(script);

    expect(text).toContain("HOOK: The hook line.");
    expect(text).toContain("1. First shot");
    expect(text).toContain("2. Second shot");
    expect(text).toContain("YOUTUBE TITLE:\nThe YouTube title.");
    expect(text).toContain("YOUTUBE DESCRIPTION:\nThe YouTube description.");
    expect(text).toContain("TIKTOK CAPTION:\nThe TikTok caption.");
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
      hashtags: ["futurestrading"],
      disclosureCta: null,
    };

    const text = formatVideoScriptAsText(script);

    expect(text).not.toContain("DISCLOSURE/CTA");
  });
});
