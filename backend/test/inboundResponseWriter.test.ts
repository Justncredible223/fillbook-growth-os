import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftInboundResponse } from "../src/inbound/inboundResponseWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function replyResponse(reply: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply } }] });
}

describe("draftInboundResponse", () => {
  it("returns the drafted reply text from the tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Trailing drawdown resets daily on most prop firms -- worth checking your specific rules."));
    const client = new LlmClient("test-key", fetchMock);

    const reply = await draftInboundResponse(
      client,
      { authorHandle: "someTrader", messageText: "how does trailing drawdown work?", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 },
      "voice: concise",
      "Fillbook tracks prop-firm drawdown rules.",
    );

    expect(reply).toBe("Trailing drawdown resets daily on most prop firms -- worth checking your specific rules.");
  });

  it("includes relationship context in the prompt for a repeat engager", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Good to hear from you again."));
    const client = new LlmClient("test-key", fetchMock);

    await draftInboundResponse(
      client,
      { authorHandle: "regular", messageText: "back again with another question", inResponseToText: null, isRepeatEngager: true, priorInteractionCount: 3 },
      "voice: concise",
      "",
    );

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("engaged with @FillbookHQ 3 time(s) before");
  });

  it("notes when there's no prior engagement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Thanks for the question."));
    const client = new LlmClient("test-key", fetchMock);

    await draftInboundResponse(
      client,
      { authorHandle: "stranger", messageText: "first time seeing this", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 },
      "voice: concise",
      "",
    );

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("No prior recorded engagement");
  });
});
