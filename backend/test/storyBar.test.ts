import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { MOTION_SCENE_PLANS } from "../src/shortform/motionPlans";
import { MIN_RENDER_SCORE, assertMeetsRenderBar, renderBar, renderBarRefusal } from "../src/shortform/storyScore";

/**
 * Owner rule (2026-09-30): only concepts that grade A or A+ are ever rendered. Enforced at three points, each proven here
 * without any mock of the bar: the app's concept list, the request handler, and the render worker's own guard.
 */
const passing = MOTION_SCENE_PLANS.filter((p) => renderBar(p).ok);
const failing = MOTION_SCENE_PLANS.filter((p) => !renderBar(p).ok);
const WEAK_ID = "pilot-7-payoff-a";

function fakeReq(body: unknown, method = "POST"): VercelRequest {
  return { method, headers: { authorization: "Bearer test-app-token" }, body } as unknown as VercelRequest;
}
function fakeRes() {
  const res: { statusCode: number | null; body: unknown } = { statusCode: null, body: null };
  const handle = {
    status: vi.fn((code: number) => { res.statusCode = code; return handle; }),
    json: vi.fn((payload: unknown) => { res.body = payload; return handle; }),
  };
  return { res: handle as unknown as VercelResponse, result: res };
}
function createFakeClient() {
  const rpcCalls: string[] = [];
  const inserted: unknown[] = [];
  const builder: any = {
    select: () => builder, eq: () => builder, ilike: () => builder, like: () => builder, in: () => builder,
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    order: async () => ({ data: [], error: null }),
    limit: async () => ({ data: [], error: null }),
    single: async () => ({ data: { paused: false }, error: null }),
    insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { ...row, id: "opp-1", status: "open", created_at: new Date().toISOString() }, error: null }) }) }; },
  };
  return {
    client: { from: () => builder, rpc: async (fn: string) => { rpcCalls.push(fn); return { data: [{ campaign_run_request_id: "run-1", job_id: "job-1", already_existed: false }], error: null }; } },
    rpcCalls,
    inserted,
  };
}

describe("the render bar", () => {
  it("passes only A and A+ concepts, and the library has both kinds", () => {
    expect(MIN_RENDER_SCORE).toBe(85);
    expect(passing.length).toBeGreaterThan(0);
    expect(failing.length).toBeGreaterThan(passing.length);
    for (const p of passing) expect(["A", "A+"]).toContain(renderBar(p).grade);
    for (const p of failing) expect(["B", "C", "D"]).toContain(renderBar(p).grade);
  });

  it("refuses a concept below the bar with its grade, the bar and what to fix", () => {
    const weak = MOTION_SCENE_PLANS.find((p) => p.planId === WEAK_ID)!;
    expect(() => assertMeetsRenderBar(weak)).toThrow(/Story bar not met/);
    const text = renderBarRefusal(weak);
    expect(text).toContain(WEAK_ID);
    expect(text).toMatch(/only A and A\+ \(85\+\) are rendered/);
    expect(text).toMatch(/Fix first: .+:/);
  });

  it("lets a passing concept through untouched", () => {
    for (const p of passing) expect(() => assertMeetsRenderBar(p)).not.toThrow();
  });
});

describe("the app's request handler", () => {
  let handler: typeof import("../api/run-campaign").default;
  let state: ReturnType<typeof createFakeClient>;

  beforeEach(async () => {
    process.env.APP_API_TOKEN = "test-app-token";
    state = createFakeClient();
    vi.resetModules();
    vi.doMock("../src/lib/supabaseClient.js", () => ({ getServiceClient: () => state.client }));
    handler = (await import("../api/run-campaign")).default;
  });
  afterEach(() => {
    vi.doUnmock("../src/lib/supabaseClient.js");
    vi.resetModules();
  });

  it("offers only concepts that clear the bar, and lists the rest with their grade and fixes", async () => {
    const { res, result } = fakeRes();
    await handler(fakeReq(undefined, "GET"), res);
    expect(result.statusCode).toBe(200);
    const body = result.body as { motionConcepts: { id: string }[]; belowBarMotionConcepts: { id: string; score: number; grade: string; fixes: string[] }[] };
    expect(body.motionConcepts.map((c) => c.id).sort()).toEqual(passing.map((p) => p.planId).sort());
    expect(body.belowBarMotionConcepts.map((c) => c.id).sort()).toEqual(failing.map((p) => p.planId).sort());
    expect(body.motionConcepts.length + body.belowBarMotionConcepts.length).toBe(MOTION_SCENE_PLANS.length);
    const weak = body.belowBarMotionConcepts.find((c) => c.id === WEAK_ID)!;
    expect(weak.score).toBeLessThan(MIN_RENDER_SCORE);
    expect(weak.fixes.length).toBeGreaterThan(0);
  });

  it("refuses a request for a concept below the bar with a 409, before anything is created or queued", async () => {
    const { res, result } = fakeRes();
    await handler(fakeReq({ motionConceptId: WEAK_ID }), res);
    expect(result.statusCode).toBe(409);
    expect((result.body as { error: string }).error).toMatch(/Story bar not met/);
    expect(state.inserted).toEqual([]);
    expect(state.rpcCalls).toEqual([]);
  });

  it("accepts a request for a concept that clears the bar", async () => {
    const { res, result } = fakeRes();
    await handler(fakeReq({ motionConceptId: passing[0]!.planId }), res);
    expect(result.statusCode).toBe(200);
    expect(state.rpcCalls).toContain("enqueue_campaign_run");
  });
});

describe("the guards stay wired in", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf-8");

  it("the campaign step refuses to draft a below-bar concept before it validates or spends review budget", () => {
    const src = read("src/content/campaignPipeline.ts");
    expect(src).toContain("assertMeetsRenderBar(plan)");
    expect(src.indexOf("assertMeetsRenderBar(plan)")).toBeLessThan(src.indexOf("validateScenePlan(plan"));
  });

  it("the render worker refuses a below-bar plan before it builds anything, even one approved earlier", () => {
    const src = read("scripts/video-worker/render-single.ts");
    expect(src).toContain("assertMeetsRenderBar(motionMatch.plan)");
    expect(src.indexOf("assertMeetsRenderBar(motionMatch.plan)")).toBeLessThan(src.indexOf("buildVerifiedMotionPlan(motionMatch.plan"));
  });
});
