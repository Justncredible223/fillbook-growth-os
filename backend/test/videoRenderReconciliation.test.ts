import { afterEach, describe, it, expect, vi } from "vitest";
import { reconcileVideoRenders, sweepStuckVideoRenderDispatches } from "../src/video/videoRenderReconciliation";

interface CampaignAssetRow {
  id: string;
  asset_type: string;
  video_render_dismissed_at: string | null;
  campaigns: { status: string } | null;
}

/**
 * Minimal fake matching only the exact query shapes reconcileVideoRenders
 * actually makes -- from("campaign_assets").select(...).eq(...), then
 * from("video_renders").select(...).in(...), then rpc(...) per missing
 * asset. Not a general Supabase mock, just enough to exercise the real
 * exclusion logic (video_render_dismissed_at) without a live database.
 */
function fakeClient(assets: CampaignAssetRow[], existingRenderAssetIds: string[], rpcResults: Record<string, { eligible: boolean }>) {
  const rpc = vi.fn(async (_fn: string, args: { p_campaign_asset_id: string }) => ({
    data: [{ video_render_id: "vr-1", job_id: "job-1", already_existed: false, ...rpcResults[args.p_campaign_asset_id] }],
    error: null,
  }));

  const from = vi.fn((table: string) => {
    if (table === "campaign_assets") {
      return {
        select: () => ({
          eq: async () => ({ data: assets, error: null }),
        }),
      };
    }
    if (table === "video_renders") {
      return {
        select: () => ({
          in: async () => ({ data: existingRenderAssetIds.map((id) => ({ campaign_asset_id: id })), error: null }),
        }),
      };
    }
    throw new Error(`unexpected table in test fake: ${table}`);
  });

  return { from, rpc } as unknown as Parameters<typeof reconcileVideoRenders>[0];
}

describe("reconcileVideoRenders", () => {
  it("re-enqueues an approved video_script asset that genuinely has no video_renders row and was never dismissed", async () => {
    const client = fakeClient(
      [{ id: "asset-1", asset_type: "video_script", video_render_dismissed_at: null, campaigns: { status: "approved" } }],
      [],
      { "asset-1": { eligible: true } },
    );

    const summary = await reconcileVideoRenders(client, 30, 1);

    expect(summary).toBe("1 enqueued, 0 blocked by the daily or monthly cap (1 were missing a render row)");
  });

  it("never resurrects a dismissed video -- real production bug: a dismissed render's deleted row looked identical to a genuine crash, so this sweep kept re-enqueueing videos the owner had already cleared", async () => {
    const client = fakeClient(
      [{ id: "asset-1", asset_type: "video_script", video_render_dismissed_at: "2026-09-13T01:00:00Z", campaigns: { status: "approved" } }],
      [],
      {},
    );

    const summary = await reconcileVideoRenders(client, 30, 1);

    expect(summary).toBe("0 approved video_script assets found");
    expect((client.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("still leaves an asset alone when it already has a video_renders row, dismissed or not", async () => {
    const client = fakeClient(
      [{ id: "asset-1", asset_type: "video_script", video_render_dismissed_at: null, campaigns: { status: "approved" } }],
      ["asset-1"],
      {},
    );

    const summary = await reconcileVideoRenders(client, 30, 1);

    expect(summary).toBe("0 missing renders (1 approved assets already have a row)");
  });
});

describe("sweepStuckVideoRenderDispatches", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs {sweep: true} to trigger-video-render, authenticated with the service role key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200, text: async () => JSON.stringify({ swept: true, processed: 2 }) }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await sweepStuckVideoRenderDispatches("service-role-key-123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/functions/v1/trigger-video-render");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer service-role-key-123" });
    expect(JSON.parse(init.body as string)).toEqual({ sweep: true });
    expect(result).toContain("processed");
  });

  it("throws with the response body when the sweep call itself fails -- this must surface as a failed growth-pulse step, not swallow the error", async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => '{"error":"claim_job failed: boom"}' })) as unknown as typeof fetch;

    await expect(sweepStuckVideoRenderDispatches("service-role-key-123")).rejects.toThrow(/claim_job failed: boom/);
  });
});
