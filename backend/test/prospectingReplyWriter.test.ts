import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftProspectingReply } from "../src/prospecting/prospectingReplyWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function replyResponse(reply: string, mentionsFillbook: boolean, usesLink: boolean) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply, mentionsFillbook, usesLink } }] });
}

describe("draftProspectingReply", () => {
  it("passes the real post text, author handle, and discovery topic into the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Most firms reset at end of day, worth checking your rulebook.", false, false));
    const llmClient = new LlmClient("test-key", fetchMock);

    const result = await draftProspectingReply(
      llmClient,
      { authorHandle: "someTrader", postText: "does trailing drawdown reset daily or lock in?", discoveryQuery: "trailing_drawdown" },
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

    await draftProspectingReply(llmClient, { authorHandle: null, postText: "hi", discoveryQuery: "drawdown" }, "", "");

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("From: @unknown");
  });

  it("the system prompt instructs a value-first, mostly-no-mention default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("...", false, false));
    const llmClient = new LlmClient("test-key", fetchMock);

    await draftProspectingReply(llmClient, { authorHandle: "x", postText: "hi", discoveryQuery: "drawdown" }, "", "");

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.system).toMatch(/90%\+/);
    expect(body.system).toContain("mentionsFillbook=false");
    expect(body.system).toContain("we built Fillbook for this, check it out");
  });

  it("passes through the model's own mentionsFillbook/usesLink flags rather than inferring them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(replyResponse("Fillbook actually tracks that automatically -- fillbookhq.com/go/prospecting", true, true));
    const llmClient = new LlmClient("test-key", fetchMock);

    const result = await draftProspectingReply(
      llmClient,
      { authorHandle: "trader1", postText: "wish I had a way to track this automatically", discoveryQuery: "trading_journal" },
      "",
      "",
    );

    expect(result.mentionsFillbook).toBe(true);
    expect(result.usesLink).toBe(true);
  });
});
