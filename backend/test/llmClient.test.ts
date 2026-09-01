import { describe, it, expect, vi } from "vitest";
import { LlmClient, LlmClientError } from "../src/content/llmClient";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("LlmClient", () => {
  it("sends the tool-forcing request and returns the tool call's input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [{ type: "tool_use", name: "submit_verdict", input: { pass: true, score: 0.9 } }],
      }),
    );
    const client = new LlmClient("test-key", fetchMock);

    const result = await client.callTool(
      "system prompt",
      "user message",
      "submit_verdict",
      { type: "object", properties: {} },
    );

    expect(result).toEqual({ pass: true, score: 0.9 });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((options.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const body = JSON.parse(options.body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit_verdict" });
    expect(body.system).toBe("system prompt");
  });

  it("throws LlmClientError with the response body on a failed request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "rate limited" }, false, 429));
    const client = new LlmClient("test-key", fetchMock);

    await expect(client.callTool("sys", "user", "tool", {})).rejects.toThrow(/HTTP 429/);
  });

  it("throws LlmClientError when no matching tool call is in the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: "text", text: "no tool call" }] }));
    const client = new LlmClient("test-key", fetchMock);

    await expect(client.callTool("sys", "user", "submit_verdict", {})).rejects.toThrow(LlmClientError);
  });

  it("fires onUsage with real token counts from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "claude-sonnet-4-5-20250929",
        content: [{ type: "tool_use", name: "submit_verdict", input: { pass: true } }],
        usage: { input_tokens: 42, output_tokens: 7 },
      }),
    );
    const onUsage = vi.fn();
    const client = new LlmClient("test-key", fetchMock, undefined, onUsage);

    await client.callTool("sys", "user", "submit_verdict", {});

    expect(onUsage).toHaveBeenCalledWith({
      model: "claude-sonnet-4-5-20250929",
      inputTokens: 42,
      outputTokens: 7,
    });
  });
});
