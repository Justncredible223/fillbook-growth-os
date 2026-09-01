import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { runReviewAgent } from "../src/content/reviewAgents";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const context = {
  platform: "X",
  brandRulesSummary: "voice: concise, intelligent, relatable",
  verifiedKnowledgeSummary: "Fillbook is a futures trading journal.",
};

describe("runReviewAgent", () => {
  it("returns a structured verdict for a given agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          {
            type: "tool_use",
            name: "submit_verdict",
            input: { pass: false, score: 0.3, reasoning: "Generic opener, no real hook", issues: ["rewrite the first line"] },
          },
        ],
      }),
    );
    const client = new LlmClient("test-key", fetchMock);

    const verdict = await runReviewAgent(client, "hook_specialist", "Here's the thing about futures...", context);

    expect(verdict).toEqual({
      agent: "hook_specialist",
      pass: false,
      score: 0.3,
      reasoning: "Generic opener, no real hook",
      issues: ["rewrite the first line"],
    });
  });

  it("includes the platform, brand rules, and verified knowledge in the prompt sent to the model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: [{ type: "tool_use", name: "submit_verdict", input: { pass: true, score: 1, reasoning: "ok", issues: [] } }] }),
    );
    const client = new LlmClient("test-key", fetchMock);

    await runReviewAgent(client, "fact_checker", "Fillbook supports 8 brokers.", context);

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(options.body as string);
    const userMessage = body.messages[0].content as string;
    expect(userMessage).toContain("Platform: X");
    expect(userMessage).toContain("concise, intelligent, relatable");
    expect(userMessage).toContain("Fillbook is a futures trading journal.");
    expect(userMessage).toContain("Fillbook supports 8 brokers.");
  });

  it("uses a distinct system prompt per agent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: [{ type: "tool_use", name: "submit_verdict", input: { pass: true, score: 1, reasoning: "ok", issues: [] } }] }),
    );
    const client = new LlmClient("test-key", fetchMock);

    await runReviewAgent(client, "brand_guardian", "some content", context);
    await runReviewAgent(client, "trader", "some content", context);

    const brandGuardianSystem = JSON.parse(fetchMock.mock.calls[0]![1].body as string).system;
    const traderSystem = JSON.parse(fetchMock.mock.calls[1]![1].body as string).system;
    expect(brandGuardianSystem).not.toBe(traderSystem);
    expect(brandGuardianSystem).toContain("Brand Constitution");
    expect(traderSystem).toContain("futures day trader");
  });
});
