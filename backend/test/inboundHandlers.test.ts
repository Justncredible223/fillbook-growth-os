import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { draftResponseForInbound, InboundActionError } from "../src/inbound/inboundHandlers";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function replyResponse(reply: string, usesLink = false) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_reply", input: { reply, usesLink } }], usage: { input_tokens: 200, output_tokens: 50 } });
}

function buildClient(overrides: Record<string, any[]> = {}, platform: string = "x", body: string = "how does trailing drawdown work?") {
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
        body,
        in_response_to_text: null,
        public_metrics: {},
        priority: "normal",
        status: "new",
        draft_response: null,
        draft_uses_link: null,
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

/**
 * Regression coverage for a real, reproducible bug: a person asking "how
 * do I contact you" got permanently stuck -- any reply naming a link was
 * rejected outright, since Inbound had no way to declare a link
 * intentional at all (unlike Prospecting's usesLink flag). Mirrors
 * Prospecting's usesLink pattern, but stricter: a link is only ever
 * accepted when (1) the model declares usesLink=true AND (2) the ORIGINAL
 * message actually asked for contact info/a link AND (3) the link
 * resolves to Fillbook's own approved domain -- see xReplyGuardrails.ts
 * and inboundResponseWriter.ts's INBOUND_APPROVED_LINK_DOMAINS/
 * INBOUND_TRACKABLE_LINK.
 */
describe("draftResponseForInbound -- link handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a contact question + the approved Fillbook link passes and persists", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Happy to help directly -- fillbookhq.com/go/contact", true)) as unknown as typeof fetch;

    const client = buildClient({}, "x", "Interesting how do I contact you though");
    const result = await draftResponseForInbound(asSupabase(client), "eng-1");

    expect(result.status).toBe("draft_ready");
    // The static placeholder link the model was told to use gets swapped
    // for a real per-engagement trackable link before persisting -- see
    // trackableLinks.ts. The raw placeholder should never survive into the
    // final draft.
    expect(result.draftResponse).not.toContain("fillbookhq.com/go/contact");
    expect(result.draftResponse).toContain("fillbook-growth-os.vercel.app/api/ingest");
    expect(result.draftResponse).toContain("key=inbound%3Aeng-1");
    expect(result.draftUsesLink).toBe(true);
    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("draft_ready");
    expect(row.draft_uses_link).toBe(true);
  });

  it("a contact question + an undeclared link (usesLink left false) still rejects", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Happy to help directly -- fillbookhq.com/go/contact", false)) as unknown as typeof fetch;

    const client = buildClient({}, "x", "Interesting how do I contact you though");
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/wasn't declared as intentional/);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new");
    expect(row.draft_response).toBeNull();
  });

  it("a non-contact conversation + a declared link rejects (the conversation never asked for one)", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Totally -- check the details here: fillbookhq.com/go/contact", true)) as unknown as typeof fetch;

    const client = buildClient({}, "x", "how does trailing drawdown work?");
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/never asked for contact info or a link/);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new");
    expect(row.draft_response).toBeNull();
    expect(row.draft_uses_link).toBeNull();
  });

  it("a contact question + an arbitrary external domain rejects, even with usesLink=true", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Reach us at some-random-domain.com/contact", true)) as unknown as typeof fetch;

    const client = buildClient({}, "x", "how do I contact you though");
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(/isn't an approved Fillbook link/);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new");
    expect(row.draft_response).toBeNull();
  });

  it("every rejected-link scenario above leaves the row completely unadvanced -- never persisted, never draft_ready", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValue(replyResponse("Try somethingelse.io for more info", true)) as unknown as typeof fetch;

    const client = buildClient({}, "x", "how do I contact you though");
    await expect(draftResponseForInbound(asSupabase(client), "eng-1")).rejects.toThrow(InboundActionError);

    const row = client.tables.inbound_engagements!.find((r) => r.id === "eng-1")!;
    expect(row.status).toBe("new");
    expect(row.draft_response).toBeNull();
    expect(row.draft_uses_link).toBeNull();
  });
});
