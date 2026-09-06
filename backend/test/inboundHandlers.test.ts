import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { draftResponseForInbound, InboundActionError } from "../src/inbound/inboundHandlers";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function replyResponse(reply: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply } }], usage: { input_tokens: 200, output_tokens: 50 } });
}

function buildClient(overrides: Record<string, any[]> = {}, platform: string = "x") {
  return new FakeSupabaseClient({
    inbound_engagements: [
      {
        id: "eng-1",
        platform,
        external_id: "ext-1",
        conversation_id: null,
        in_reply_to_external_id: null,
        author_handle: "someTrader",
        author_external_id: "user-1",
        creator_id: null,
        body: "how does trailing drawdown work?",
        in_response_to_text: null,
        public_metrics: {},
        priority: "normal",
        status: "new",
        draft_response: null,
        responded_at: null,
        responded_note: null,
        is_repeat_engager: false,
        observed_at: new Date().toISOString(),
        source_reference: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    brand_rules: [],
    knowledge_documents: [],
    cost_events: [],
    ...overrides,
  });
}

describe("draftResponseForInbound", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("REFINED: rejects and never persists a draft that trips the mechanical reply guardrail", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(replyResponse("Struggling with this? Check out our platform, it solves exactly this!")) as unknown as typeof fetch;

    const client = buildClient();
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(InboundActionError);
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/banned generic phrase/);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new"); // never advanced to draft_ready
    expect(row.draft_response).toBeNull();
  });

  it("REFINED: rejects a draft with an unsupported personal-trading claim", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(replyResponse("I've made consistent profits every month with this rule.")) as unknown as typeof fetch;

    const client = buildClient();
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/personally trading/);
  });

  it("accepts and persists a clean, genuinely helpful draft with no Fillbook mention", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Most firms reset trailing drawdown at end of day, but a few lock it in -- worth checking your specific rulebook."));
    const client = buildClient();

    const result = await draftResponseForInbound(asSupabase(client), "eng-1");

    expect(result.status).toBe("draft_ready");
    expect(result.draftResponse).toContain("Most firms reset trailing drawdown");
    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("draft_ready");
  });

  it("REFINED: the guardrail applies regardless of platform, not just X", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(replyResponse("DM me and I'll walk you through exactly how Fillbook does this.")) as unknown as typeof fetch;

    const client = buildClient({}, "youtube");
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/banned generic phrase/);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new");
    expect(row.draft_response).toBeNull();
  });
});
