import { describe, it, expect } from "vitest";
import { listResearchRecords, recordResearchCost, resolveResearchRecordStatus, parseResearchReport } from "../src/research/researchHandlers";

/**
 * Regression coverage for the Research Lab feature (2026-09-07): a
 * private, internal research-document pipeline that reuses
 * campaign_assets/content_versions exactly like every other content
 * type -- asset_type='research', metadata.research holding the
 * structured ResearchReport (mirrors metadata.videoScript for video).
 */

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private result: { data: unknown; error: unknown }) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  in() {
    return this;
  }
  update(_payload: unknown) {
    void _payload;
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
  async single() {
    return this.result;
  }
  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** Pops the next queued result for a table on each `.from(table)` call (when more than one is queued), so a handler that hits the same table twice (e.g. recordResearchCost's select-then-update) gets each result in order. */
function fakeSupabase(tableQueues: Record<string, Array<{ data: unknown; error: unknown }>>) {
  const queues: Record<string, Array<{ data: unknown; error: unknown }>> = Object.fromEntries(
    Object.entries(tableQueues).map(([k, v]) => [k, [...v]]),
  );
  return {
    from: (table: string) => {
      const queue = queues[table] ?? [];
      const result = queue.length > 1 ? queue.shift()! : (queue[0] ?? { data: null, error: null });
      return new FakeQuery(result);
    },
  } as any;
}

const wellFormedResearch = {
  research: {
    title: "Trailing drawdown confusion",
    question: "Do funded traders understand trailing drawdown?",
    summary: "Many misunderstand the mechanics.",
    findings: ["Finding one"],
    evidenceReferences: ["Fillbook doc"],
    caveats: ["General reasoning"],
    contentAngles: ["Explainer video"],
  },
};

describe("parseResearchReport", () => {
  it("extracts a well-formed research report", () => {
    expect(parseResearchReport(wellFormedResearch)).toEqual(wellFormedResearch.research);
  });

  it("returns null when metadata has no research at all", () => {
    expect(parseResearchReport({})).toBeNull();
    expect(parseResearchReport(null)).toBeNull();
    expect(parseResearchReport(undefined)).toBeNull();
  });

  it("returns null rather than throwing on a malformed/partial research object", () => {
    expect(parseResearchReport({ research: { title: "only a title" } })).toBeNull();
    expect(parseResearchReport({ research: "not an object" })).toBeNull();
    expect(parseResearchReport({ research: { ...wellFormedResearch.research, findings: "not an array" } })).toBeNull();
  });
});

describe("resolveResearchRecordStatus", () => {
  it("maps campaign status 'approved' to 'approved'", () => {
    expect(resolveResearchRecordStatus("approved", "handed_off")).toBe("approved");
  });

  it("maps campaign status 'retired' to 'rejected'", () => {
    expect(resolveResearchRecordStatus("retired", "retired")).toBe("rejected");
  });

  it("maps in_review + ready_for_owner to 'ready_for_review'", () => {
    expect(resolveResearchRecordStatus("in_review", "ready_for_owner")).toBe("ready_for_review");
  });

  it("maps a still-'draft' campaign (mechanical gate rejected it) to 'failed'", () => {
    expect(resolveResearchRecordStatus("draft", "draft")).toBe("failed");
  });
});

describe("listResearchRecords", () => {
  it("maps a ready_for_owner research asset into a ready_for_review record", async () => {
    const client = fakeSupabase({
      campaign_assets: [
        {
          data: [{ id: "asset-1", stage: "ready_for_owner", created_at: "2026-09-07T00:00:00Z", campaigns: { status: "in_review" } }],
          error: null,
        },
      ],
      content_versions: [
        {
          data: [{ campaign_asset_id: "asset-1", metadata: { ...wellFormedResearch, costUsd: 0.012 } }],
          error: null,
        },
      ],
    });

    const records = await listResearchRecords(client);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "asset-1",
      title: "Trailing drawdown confusion",
      status: "ready_for_review",
      costUsd: 0.012,
    });
  });

  it("returns an empty list when there are no research assets", async () => {
    const client = fakeSupabase({ campaign_assets: [{ data: [], error: null }] });
    expect(await listResearchRecords(client)).toEqual([]);
  });

  it("skips a research asset whose latest content_versions row has no readable research metadata", async () => {
    const client = fakeSupabase({
      campaign_assets: [
        { data: [{ id: "asset-2", stage: "draft", created_at: "2026-09-07T00:00:00Z", campaigns: { status: "draft" } }], error: null },
      ],
      content_versions: [{ data: [{ campaign_asset_id: "asset-2", metadata: {} }], error: null }],
    });

    expect(await listResearchRecords(client)).toEqual([]);
  });

  it("throws when the campaign_assets query itself fails", async () => {
    const client = fakeSupabase({ campaign_assets: [{ data: null, error: { message: "boom" } }] });
    await expect(listResearchRecords(client)).rejects.toThrow("boom");
  });
});

describe("recordResearchCost", () => {
  it("merges costUsd into the latest content_versions row's existing metadata", async () => {
    let updatedPayload: unknown;
    const client = {
      from: (table: string) => {
        if (table !== "content_versions") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { id: "version-1", metadata: { research: wellFormedResearch.research } },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
          update: (payload: unknown) => {
            updatedPayload = payload;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    } as any;

    await recordResearchCost(client, "asset-1", 0.02);

    expect(updatedPayload).toEqual({ metadata: { research: wellFormedResearch.research, costUsd: 0.02 } });
  });

  it("never throws when no content_versions row exists yet", async () => {
    const client = fakeSupabase({ content_versions: [{ data: null, error: null }] });
    await expect(recordResearchCost(client, "asset-missing", 0.02)).resolves.toBeUndefined();
  });

  it("never throws when the select itself errors", async () => {
    const client = fakeSupabase({ content_versions: [{ data: null, error: { message: "db down" } }] });
    await expect(recordResearchCost(client, "asset-1", 0.02)).resolves.toBeUndefined();
  });

  it("never throws when the update itself fails", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: "version-1", metadata: {} }, error: null }),
              }),
            }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: { message: "update failed" } }) }),
      }),
    } as any;

    await expect(recordResearchCost(client, "asset-1", 0.02)).resolves.toBeUndefined();
  });
});
