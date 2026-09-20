import { describe, it, expect } from "vitest";
import { loadInboundStyleExamples } from "../src/inbound/inboundStyleExamples";
import { draftInboundResponse } from "../src/inbound/inboundResponseWriter";
import { vi } from "vitest";

describe("loadInboundStyleExamples", () => {
  it("returns [] instead of throwing when the lookup fails", async () => {
    expect(await loadInboundStyleExamples({} as any)).toEqual([]);
  });

  it("maps a responded row's message, draft and final into an example", async () => {
    const rows = [{ body: "does it work with Tradovate?", draft_response: "Great question! Yes it does.", final_response: "yep, Tradovate imports fine." }];
    const chain: any = { select: () => chain, eq: () => chain, not: () => chain, order: () => chain, limit: async () => ({ data: rows, error: null }) };
    const out = await loadInboundStyleExamples({ from: () => chain } as any);
    expect(out).toEqual([{ theirPost: "does it work with Tradovate?", aiDraft: "Great question! Yes it does.", ownerFinal: "yep, Tradovate imports fine." }]);
  });
});

describe("draftInboundResponse with style examples", () => {
  const ctx = { platform: "x", authorHandle: "a", messageText: "hi", inResponseToText: null, isRepeatEngager: false, priorInteractionCount: 0 };
  const client = () => ({ callTool: vi.fn(async () => ({ reply: "r", usesLink: false })) }) as any;

  it("includes the examples when given and omits the section otherwise", async () => {
    const withEx = client();
    await draftInboundResponse(withEx, { ...ctx, styleExamples: [{ theirPost: "p", aiDraft: "d", ownerFinal: "f" }] }, "brand", "facts");
    expect(withEx.callTool.mock.calls[0][1]).toContain("How the owner edits our drafts");
    const without = client();
    await draftInboundResponse(without, ctx, "brand", "facts");
    expect(without.callTool.mock.calls[0][1]).not.toContain("How the owner edits our drafts");
  });
});
