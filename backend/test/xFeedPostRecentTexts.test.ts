import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildXFeedPostStepDeps, OWNER_REVIEWED_STAGES } from "../src/content/buildXFeedPostStepDeps";
import { X_FEED_POST_ASSET_TYPE } from "../src/content/dailyXFeedPost";

// A chainable fake of the Supabase query builder that records every filter and resolves to rows per table.
function fakeClient(tables: Record<string, unknown[]>) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    const chain = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return builder;
    };
    for (const op of ["select", "eq", "in", "not", "order", "limit", "is", "neq"]) builder[op] = chain(op);
    builder.maybeSingle = async () => ({ data: null, error: null });
    builder.single = async () => ({ data: null, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
    return builder;
  };
  return { client: { from } as never, calls };
}

describe("recent X posts used by the originality check", () => {
  // buildXFeedPostStepDeps constructs the AI client, which needs a key to exist; nothing here ever calls it.
  beforeEach(() => { vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-used"); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("only counts drafts that reached the owner, never the review gate's rejected attempts", () => {
    expect(OWNER_REVIEWED_STAGES).toEqual(["ready_for_owner", "handed_off", "retired"]);
    expect(OWNER_REVIEWED_STAGES).not.toContain("final_draft");
    expect(OWNER_REVIEWED_STAGES).not.toContain("draft");
  });

  it("filters the lookback query by those stages", async () => {
    const { client, calls } = fakeClient({ campaign_assets: [{ id: "a1" }], content_versions: [{ campaign_asset_id: "a1", body: "A reviewed post." }] });
    const { deps } = await buildXFeedPostStepDeps(client);
    const stageFilter = calls.find((c) => c.table === "campaign_assets" && c.op === "in" && c.args[0] === "stage");
    expect(stageFilter?.args[1]).toEqual(OWNER_REVIEWED_STAGES);
    expect(calls.some((c) => c.table === "campaign_assets" && c.op === "eq" && c.args[0] === "asset_type" && c.args[1] === X_FEED_POST_ASSET_TYPE)).toBe(true);
    expect(deps.recentFeedPostTexts).toEqual(["A reviewed post."]);
  });
});
