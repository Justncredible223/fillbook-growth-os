import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { runDeepReview } from "../src/content/deepReviewGate";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function verdictResponse(pass: boolean, reasoning = "ok") {
  return jsonResponse({
    content: [{ type: "tool_use", name: "submit_verdict", input: { pass, score: pass ? 1 : 0.2, reasoning, issues: [] } }],
  });
}

const context = { platform: "X", brandRulesSummary: "", verifiedKnowledgeSummary: "" };

describe("runDeepReview", () => {
  it("passes only when every requested agent passes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);

    const result = await runDeepReview(client, ["trader", "copy_editor"], "content", context);

    expect(result.passed).toBe(true);
    expect(result.verdicts).toHaveLength(2);
    expect(result.blockReasons).toEqual([]);
  });

  it("fails and reports reasons when any agent fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(verdictResponse(true))
      .mockResolvedValueOnce(verdictResponse(false, "Uses forbidden hashtag spam pattern"));
    const client = new LlmClient("test-key", fetchMock);

    const result = await runDeepReview(client, ["trader", "integrity_reviewer"], "content", context);

    expect(result.passed).toBe(false);
    expect(result.blockReasons).toEqual(["integrity_reviewer: Uses forbidden hashtag spam pattern"]);
  });

  it("runs every requested agent even when one fails (no short-circuit)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(verdictResponse(false, "fail"));
    const client = new LlmClient("test-key", fetchMock);

    await runDeepReview(client, ["trader", "hook_specialist", "copy_editor"], "content", context);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
