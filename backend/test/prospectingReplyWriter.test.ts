import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import {
  draftProspectingReply,
  buildProspectingSystemPrompt,
  prospectingPlatformProfile,
  PROSPECTING_TRACKABLE_LINK,
} from "../src/prospecting/prospectingReplyWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function replyResponse(reply: string, mentionsFillbook: boolean, usesLink: boolean) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply, mentionsFillbook, usesLink } }] });
}

async function capturePrompt(platform: string, extra: Partial<Parameters<typeof draftProspectingReply>[1]> = {}) {
  const fetchMock = vi.fn().mockResolvedValue(replyResponse("...", false, false));
  const llmClient = new LlmClient("test-key", fetchMock);
  await draftProspectingReply(llmClient, { platform, authorHandle: "someone", postText: "hi", discoveryQuery: "drawdown", ...extra }, "", "");
  const [, options] = fetchMock.mock.calls[0]!;
  const body = JSON.parse((options as { body: string }).body);
  return { system: body.system as string, user: body.messages[0].content as string };
}

describe("draftProspectingReply", () => {
  it("passes the real post text, author handle, and discovery topic into the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Most firms reset at end of day, worth checking your rulebook.", false, false));
    const llmClient = new LlmClient("test-key", fetchMock);

    const result = await draftProspectingReply(
      llmClient,
      { platform: "x", authorHandle: "someTrader", postText: "does trailing drawdown reset daily or lock in?", discoveryQuery: "trailing_drawdown" },
      "voice: concise",
      "",
    );

    expect(result).toEqual({
      reply: "Most firms reset at end of day, worth checking your rulebook.",
      mentionsFillbook: false,
      usesLink: false,
    });
    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("From: @someTrader");
    expect(body.messages[0].content).toContain("does trailing drawdown reset daily or lock in?");
    expect(body.messages[0].content).toContain("trailing_drawdown");
  });

  it("does not fabricate an author handle when none is known", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Good question.", false, false));
    const llmClient = new LlmClient("test-key", fetchMock);

    await draftProspectingReply(llmClient, { platform: "x", authorHandle: null, postText: "hi", discoveryQuery: "drawdown" }, "", "");

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("From: @unknown");
  });

  it("the system prompt instructs a value-first, mostly-no-mention default", async () => {
    const { system } = await capturePrompt("x");

    expect(system).toMatch(/90%\+/);
    expect(system).toContain("mentionsFillbook=false");
    expect(system).toContain("we built Fillbook for this, check it out");
  });

  it("passes through the model's own mentionsFillbook/usesLink flags rather than inferring them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(replyResponse("Fillbook actually tracks that automatically -- fillbookhq.com/go/prospecting", true, true));
    const llmClient = new LlmClient("test-key", fetchMock);

    const result = await draftProspectingReply(
      llmClient,
      { platform: "x", authorHandle: "trader1", postText: "wish I had a way to track this automatically", discoveryQuery: "trading_journal" },
      "",
      "",
    );

    expect(result.mentionsFillbook).toBe(true);
    expect(result.usesLink).toBe(true);
  });

  describe("platform awareness", () => {
    it("an X candidate is framed as an X post with X's short-reply shape and the trackable link", async () => {
      const { system, user } = await capturePrompt("x");

      expect(system).toContain("public X post on X");
      expect(system).toContain("Shape for X:");
      expect(system).toContain("one or two sentences");
      expect(system).toContain(PROSPECTING_TRACKABLE_LINK);
      expect(system).not.toContain("Reddit");
      expect(user).toContain("Platform: X");
      expect(user).toContain("From: @someone");
    });

    it("a Reddit candidate is framed as a Reddit comment, never as an X post, with Reddit's stricter link policy and u/ handles", async () => {
      const { system, user } = await capturePrompt("reddit", { communityLabel: "r/FuturesTrading" });

      expect(system).toContain("on Reddit");
      expect(system).toContain("Reddit comment, not a tweet");
      expect(system).toContain("Link policy for Reddit");
      expect(system).toContain("ban or heavily downvote self-promotion");
      expect(system).toContain("explicitly asked for a tool recommendation");
      expect(system).toContain(PROSPECTING_TRACKABLE_LINK);
      expect(system).not.toContain("X post");
      expect(system).not.toContain("on X");
      expect(user).toContain("Platform: Reddit (r/FuturesTrading)");
      expect(user).toContain("From: u/someone");
    });

    it("an unknown platform gets a neutral profile instead of X language or a crash", async () => {
      const { system, user } = await capturePrompt("mastodon");

      expect(system).toContain("public mastodon post on mastodon");
      expect(system).not.toContain("X post");
      expect(user).toContain("Platform: mastodon");
    });

    it("platform lookup is case-insensitive and every profile pins the single allowed link", () => {
      expect(prospectingPlatformProfile("Reddit").displayName).toBe("Reddit");
      expect(prospectingPlatformProfile("X").displayName).toBe("X");
      for (const platform of ["x", "reddit", "unknown"]) {
        const profile = prospectingPlatformProfile(platform);
        expect(profile.trackableLink).toBe(PROSPECTING_TRACKABLE_LINK);
        expect(buildProspectingSystemPrompt(profile)).toContain(PROSPECTING_TRACKABLE_LINK);
      }
    });
  });
});
