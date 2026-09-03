import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { draftOpportunityReply, OpportunityReplyError } from "../src/opportunities/opportunityReplyWriter";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function replyResponse(reply: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply } }] });
}

/**
 * Minimal fake covering only the chain draftOpportunityReply actually
 * calls (.from(table).select(cols).eq(col, val).single()) -- table
 * lookups keyed by table name, returning whatever row/error was queued.
 */
function fakeSupabase(rows: Record<string, { data: unknown; error: unknown } | undefined>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => rows[table] ?? { data: null, error: new Error(`no fixture for table ${table}`) },
        }),
      }),
    }),
  } as any;
}

describe("draftOpportunityReply", () => {
  it("drafts a reply using the real message text and author handle from the linked signal", async () => {
    const client = fakeSupabase({
      opportunities: { data: { id: "opp-1", signal_ids: ["sig-1"] }, error: null },
      signals: {
        data: {
          id: "sig-1",
          source: "x_mention",
          source_reference: "https://x.com/i/web/status/999",
          evidence: { text: "how do you handle trailing drawdown?", authorHandle: "someTrader" },
        },
        error: null,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Depends on the firm -- most reset at end of day."));
    const llmClient = new LlmClient("test-key", fetchMock);

    const draft = await draftOpportunityReply(client, llmClient, "opp-1", "voice: concise", "");

    expect(draft).toBe("Depends on the firm -- most reset at end of day.");
    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("From: @someTrader");
    expect(body.messages[0].content).toContain("how do you handle trailing drawdown?");
  });

  it("does not fabricate an author handle when the signal never resolved one", async () => {
    const client = fakeSupabase({
      opportunities: { data: { id: "opp-1", signal_ids: ["sig-1"] }, error: null },
      signals: {
        data: {
          id: "sig-1",
          source: "x_mention",
          source_reference: "https://x.com/i/web/status/999",
          evidence: { text: "hi", authorHandle: null },
        },
        error: null,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(replyResponse("Thanks!"));
    const llmClient = new LlmClient("test-key", fetchMock);

    await draftOpportunityReply(client, llmClient, "opp-1", "voice: concise", "");

    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((options as { body: string }).body);
    expect(body.messages[0].content).toContain("From: @unknown");
  });

  it("refuses a multi-signal opportunity rather than guessing which signal to use", async () => {
    const client = fakeSupabase({
      opportunities: { data: { id: "opp-1", signal_ids: ["sig-1", "sig-2"] }, error: null },
    });
    const llmClient = new LlmClient("test-key", vi.fn());

    await expect(draftOpportunityReply(client, llmClient, "opp-1", "", "")).rejects.toThrow(OpportunityReplyError);
  });

  it("refuses an opportunity whose signal isn't an x_mention", async () => {
    const client = fakeSupabase({
      opportunities: { data: { id: "opp-1", signal_ids: ["sig-1"] }, error: null },
      signals: {
        data: { id: "sig-1", source: "youtube_video", source_reference: "https://youtube.com/watch?v=abc", evidence: { text: "hi" } },
        error: null,
      },
    });
    const llmClient = new LlmClient("test-key", vi.fn());

    await expect(draftOpportunityReply(client, llmClient, "opp-1", "", "")).rejects.toThrow(OpportunityReplyError);
  });

  it("refuses when the opportunity doesn't exist", async () => {
    const client = fakeSupabase({});
    const llmClient = new LlmClient("test-key", vi.fn());

    await expect(draftOpportunityReply(client, llmClient, "missing", "", "")).rejects.toThrow(OpportunityReplyError);
  });
});
