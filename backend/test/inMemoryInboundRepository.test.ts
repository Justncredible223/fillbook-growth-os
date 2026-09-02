import { describe, it, expect } from "vitest";
import { InMemoryInboundRepository } from "../src/inbound/inMemoryInboundRepository";
import type { NewInboundEngagement } from "../src/inbound/types";

function newRow(overrides: Partial<NewInboundEngagement> = {}): NewInboundEngagement {
  return {
    platform: "x",
    externalId: "1",
    conversationId: null,
    inReplyToExternalId: null,
    authorHandle: "someTrader",
    authorExternalId: "author-1",
    creatorId: null,
    body: "how do you track this?",
    inResponseToText: null,
    publicMetrics: {},
    priority: "p3_comment",
    status: "needs_response",
    draftResponse: null,
    respondedAt: null,
    respondedNote: null,
    isRepeatEngager: false,
    observedAt: "2026-09-01T12:00:00Z",
    sourceReference: null,
    ...overrides,
  };
}

describe("InMemoryInboundRepository", () => {
  it("upsertIfNew creates once, then reports created:false for the same (platform, externalId)", async () => {
    const repo = new InMemoryInboundRepository();
    const first = await repo.upsertIfNew(newRow());
    const second = await repo.upsertIfNew(newRow());

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(repo.all()).toHaveLength(1);
  });

  it("draft_ready is a distinct status from responded -- generating a draft never implies a reply was sent", async () => {
    const repo = new InMemoryInboundRepository();
    const { id } = await repo.upsertIfNew(newRow());

    await repo.updateStatus(id, "draft_ready", { draftResponse: "Here's a draft reply." });
    const afterDraft = await repo.getById(id);
    expect(afterDraft?.status).toBe("draft_ready");
    expect(afterDraft?.respondedAt).toBeNull();

    await repo.updateStatus(id, "responded", { respondedAt: "2026-09-01T13:00:00Z" });
    const afterResponse = await repo.getById(id);
    expect(afterResponse?.status).toBe("responded");
    expect(afterResponse?.draftResponse).toBe("Here's a draft reply."); // draft text preserved as a record of what was sent
  });

  it("findLatestInConversation returns the most recently observed row in that thread", async () => {
    const repo = new InMemoryInboundRepository();
    await repo.upsertIfNew(newRow({ externalId: "1", conversationId: "conv-1", observedAt: "2026-09-01T10:00:00Z" }));
    await repo.upsertIfNew(newRow({ externalId: "2", conversationId: "conv-1", observedAt: "2026-09-01T12:00:00Z" }));

    const latest = await repo.findLatestInConversation("conv-1");

    expect(latest?.externalId).toBe("2");
  });

  it("listByStatus filters correctly and excludes non-matching statuses", async () => {
    const repo = new InMemoryInboundRepository();
    await repo.upsertIfNew(newRow({ externalId: "1", status: "needs_response" }));
    await repo.upsertIfNew(newRow({ externalId: "2", status: "closed" }));

    const active = await repo.listByStatus(["needs_response", "follow_up"]);

    expect(active).toHaveLength(1);
    expect(active[0]!.externalId).toBe("1");
  });

  it("updateStatus throws on an unknown id rather than silently no-op'ing", async () => {
    const repo = new InMemoryInboundRepository();
    await expect(repo.updateStatus("nonexistent", "closed")).rejects.toThrow(/No inbound_engagements row/);
  });

  it("countPriorFromAuthor counts only rows for that exact platform+author", async () => {
    const repo = new InMemoryInboundRepository();
    await repo.upsertIfNew(newRow({ externalId: "1", authorExternalId: "author-1" }));
    await repo.upsertIfNew(newRow({ externalId: "2", authorExternalId: "author-1" }));
    await repo.upsertIfNew(newRow({ externalId: "3", authorExternalId: "author-2" }));

    expect(await repo.countPriorFromAuthor("x", "author-1")).toBe(2);
    expect(await repo.countPriorFromAuthor("x", "author-2")).toBe(1);
    expect(await repo.countPriorFromAuthor("x", "author-3")).toBe(0);
  });
});
