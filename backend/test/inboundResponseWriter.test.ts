import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftInboundResponse } from "../src/inbound/inboundResponseWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function replyResponse(reply: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply } }] });
}

async function capture(context: Parameters<typeof draftInboundResponse>[1]) {
  const fetchMock = vi.fn().mockResolvedValue(replyResponse("..."));
  const client = new LlmClient("test-key", fetchMock);
  await draftInboundResponse(client, context, "voice: concise", "");
  const [, options] = fetchMock.mock.calls[0]!;
  const body = JSON.parse((options as { body: string }).body);
  return { system: body.system as string, user: body.messages[0].content as string };
}

describe("draftInboundResponse", () => {
  it("returns the drafted reply text from the tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Trailing drawdown resets daily on most prop firms -- worth checking your specific rules."));
    const client = new LlmClient("test-key", fetchMock);

    const reply = await draftInboundResponse(
      client,
      { platform: "x", authorHandle: "someTrader", messageText: "how does trailing drawdown work?", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 },
      "voice: concise",
      "Fillbook tracks prop-firm drawdown rules.",
    );

    expect(reply).toBe("Trailing drawdown resets daily on most prop firms -- worth checking your specific rules.");
  });

  it("includes relationship context in the prompt for a repeat engager", async () => {
    const { user } = await capture({ platform: "x", authorHandle: "regular", messageText: "back again with another question", inResponseToText: null, isRepeatEngager: true, priorInteractionCount: 3 });

    expect(user).toContain("engaged with Fillbook on X 3 time(s) before");
  });

  it("notes when there's no prior engagement", async () => {
    const { user } = await capture({ platform: "x", authorHandle: "stranger", messageText: "first time seeing this", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 });

    expect(user).toContain("No prior recorded engagement");
  });

  it("an X engagement is framed as an X reply", async () => {
    const { system, user } = await capture({ platform: "x", authorHandle: "someone", messageText: "hi", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 });

    expect(system).toContain("on X");
    expect(system).not.toContain("Reddit");
    expect(user).toContain("Platform: X");
    expect(user).toContain("From: @someone");
  });

  it("a Reddit engagement is framed as a Reddit comment reply with u/ handles, never as an X reply", async () => {
    const { system, user } = await capture({ platform: "reddit", authorHandle: "someone", messageText: "hi", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 });

    expect(system).toContain("on Reddit");
    expect(system).toContain("Reddit comment reply");
    expect(system).not.toContain("on X");
    expect(user).toContain("Platform: Reddit");
    expect(user).toContain("From: u/someone");
  });

  it("REFINED (2026-09-05): X's prompt gives the same earned-mention structure as Prospecting's X refresh, not the old blanket 'unless specifically about journaling tools' rule", async () => {
    const { system } = await capture({ platform: "x", authorHandle: "someone", messageText: "hi", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 });

    expect(system).toContain("only earned once the reply has already added a concrete insight");
    expect(system).toContain("That's one of the things we're trying to make easier with Fillbook");
    expect(system).toContain("Never conceal that this is the Fillbook account replying");
    expect(system).toContain("check out our platform");
  });

  it("Reddit's prompt keeps its original conservative pitch guidance, unchanged by X's refresh", async () => {
    const { system } = await capture({ platform: "reddit", authorHandle: "someone", messageText: "hi", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 });

    expect(system).toContain("unless the conversation itself is");
    expect(system).toContain("specifically about trade journaling/tracking tools");
    expect(system).not.toContain("only earned once the reply has already added a concrete insight");
  });
});
