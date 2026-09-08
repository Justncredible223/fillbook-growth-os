import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import {
  STRATEGY_BATCH_CONCURRENCY,
  STRATEGY_BATCH_SIZE,
  StrategyCollectionError,
  collectStrategyEngineInputs,
} from "../src/strategy/supabaseStrategyRepository";
import { runStep } from "../api/daily-pipeline";

const now = new Date("2026-09-04T12:00:00.000Z");

/**
 * A realistic content history: `campaignCount` campaigns, each with its
 * own opportunity and `assetsPerCampaign` assets, each asset with THREE
 * versions where only the newest carries the scores that should count
 * (older versions carry "fail" scores that must be ignored).
 */
function history(campaignCount: number, assetsPerCampaign: number) {
  const campaigns: any[] = [];
  const campaign_assets: any[] = [];
  const content_versions: any[] = [];
  const content_scores: any[] = [];

  for (let c = 0; c < campaignCount; c++) {
    const campaignId = `camp-${c}`;
    campaigns.push({ id: campaignId, opportunity_id: `opp-${c}`, opportunities: { id: `opp-${c}`, title: `Topic ${c}`, score: 50 + (c % 50) } });
    for (let a = 0; a < assetsPerCampaign; a++) {
      const assetId = `${campaignId}-asset-${a}`;
      const platform = a % 2 === 0 ? "x" : "tiktok";
      const stage = a === 0 ? "ready_for_owner" : "draft";
      campaign_assets.push({ id: assetId, campaign_id: campaignId, platform, asset_type: "post", stage });
      for (let v = 1; v <= 3; v++) {
        const versionId = `${assetId}-v${v}`;
        content_versions.push({ id: versionId, campaign_asset_id: assetId, version: v });
        if (v < 3) {
          content_scores.push({ content_version_id: versionId, verdict: "fail" }); // stale -- must not count
        } else {
          content_scores.push({ content_version_id: versionId, verdict: "pass" });
          content_scores.push({ content_version_id: versionId, verdict: a % 2 === 0 ? "pass" : "fail" });
        }
      }
    }
  }

  return { campaigns, campaign_assets, content_versions, content_scores, signals: [], creators: [] };
}

describe("collectStrategyEngineInputs -- bounded, batched aggregation", () => {
  it("40 campaigns x 5 assets x 3 versions is served by a handful of batched reads, not hundreds of per-row queries", async () => {
    const client = new FakeSupabaseClient(history(40, 5));

    const inputs = await collectStrategyEngineInputs(asSupabase(client), now);

    // 1 campaigns + ceil(40/100)=1 assets + ceil(200/100)=2 versions + ceil(200/100)=2 scores + 1 signals + 1 creators
    expect(client.log).toHaveLength(8);
    expect(client.queriesFor("campaign_assets")).toHaveLength(1);
    expect(client.queriesFor("content_versions")).toHaveLength(2);
    expect(client.queriesFor("content_scores")).toHaveLength(2);
    for (const q of client.queriesFor("content_versions")) {
      const inFilter = q.filters.find((f) => f.kind === "in")!;
      expect((inFilter.value as unknown[]).length).toBeLessThanOrEqual(STRATEGY_BATCH_SIZE);
    }

    expect(inputs.topicStats).toHaveLength(40);
    for (const topic of inputs.topicStats) {
      expect(topic.campaignCount).toBe(1);
      expect(topic.reachedReadyForOwnerCount).toBe(1);
      // 5 assets x (latest version only): even assets pass+pass, odd assets pass+fail
      expect(topic.totalContentScorePasses).toBe(3 * 2 + 2 * 1);
      expect(topic.totalContentScoreFails).toBe(2 * 1);
    }

    const x = inputs.formatStats.find((f) => f.platform === "x")!;
    const tiktok = inputs.formatStats.find((f) => f.platform === "tiktok")!;
    expect(x.assetCount).toBe(40 * 3);
    expect(tiktok.assetCount).toBe(40 * 2);
    expect(x.totalContentScoreFails).toBe(0);
    expect(tiktok.totalContentScoreFails).toBe(40 * 2);
  });

  it("produces exactly the same per-asset numbers as the old per-row reads: only the highest version's scores count", async () => {
    const client = new FakeSupabaseClient({
      campaigns: [{ id: "c1", opportunity_id: "o1", opportunities: { id: "o1", title: "T", score: 70 } }],
      campaign_assets: [{ id: "a1", campaign_id: "c1", platform: "x", asset_type: "post", stage: "handed_off" }],
      content_versions: [
        { id: "a1-v1", campaign_asset_id: "a1", version: 1 },
        { id: "a1-v3", campaign_asset_id: "a1", version: 3 },
        { id: "a1-v2", campaign_asset_id: "a1", version: 2 },
      ],
      content_scores: [
        { content_version_id: "a1-v1", verdict: "fail" },
        { content_version_id: "a1-v2", verdict: "fail" },
        { content_version_id: "a1-v3", verdict: "pass" },
        { content_version_id: "a1-v3", verdict: "fail" },
      ],
      signals: [],
      creators: [],
    });

    const inputs = await collectStrategyEngineInputs(asSupabase(client), now);

    expect(inputs.topicStats[0]).toMatchObject({ campaignCount: 1, reachedReadyForOwnerCount: 1, totalContentScorePasses: 1, totalContentScoreFails: 1 });
    expect(inputs.formatStats[0]).toMatchObject({ platform: "x", assetType: "post", assetCount: 1, totalContentScorePasses: 1, totalContentScoreFails: 1 });
    // Only the latest version id was asked for.
    const scoresQuery = client.queriesFor("content_scores")[0]!;
    expect(scoresQuery.filters[0]).toEqual({ kind: "in", column: "content_version_id", value: ["a1-v3"] });
  });

  it("skips campaigns whose opportunity is gone and never queries assets for them", async () => {
    const client = new FakeSupabaseClient({
      campaigns: [
        { id: "orphan", opportunity_id: null, opportunities: null },
        { id: "c1", opportunity_id: "o1", opportunities: { id: "o1", title: "T", score: 70 } },
      ],
      campaign_assets: [
        { id: "orphan-asset", campaign_id: "orphan", platform: "x", asset_type: "post", stage: "draft" },
        { id: "a1", campaign_id: "c1", platform: "x", asset_type: "post", stage: "draft" },
      ],
      content_versions: [],
      content_scores: [],
      signals: [],
      creators: [],
    });

    const inputs = await collectStrategyEngineInputs(asSupabase(client), now);

    expect(inputs.topicStats).toHaveLength(1);
    expect(inputs.formatStats[0]!.assetCount).toBe(1);
    expect(client.queriesFor("campaign_assets")[0]!.filters[0]).toEqual({ kind: "in", column: "campaign_id", value: ["c1"] });
    // Versions are looked up for the one real asset only; with no versions
    // there are no latest-version ids, so the scores read is skipped entirely.
    expect(client.queriesFor("content_versions")).toHaveLength(1);
    expect(client.queriesFor("content_versions")[0]!.filters[0]).toEqual({ kind: "in", column: "campaign_asset_id", value: ["a1"] });
    expect(client.queriesFor("content_scores")).toHaveLength(0);
  });

  it("never has more than STRATEGY_BATCH_CONCURRENCY batch reads in flight", async () => {
    const client = new FakeSupabaseClient(history(10, 100)); // 1000 assets -> 10 version batches, 10 score batches
    let inFlight = 0;
    let peak = 0;
    client.onExecute = async (entry) => {
      if (entry.table !== "content_versions" && entry.table !== "content_scores") return;
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
    };

    await collectStrategyEngineInputs(asSupabase(client), now);

    expect(client.queriesFor("content_versions")).toHaveLength(10);
    expect(peak).toBeGreaterThan(1); // it really did run batches concurrently...
    expect(peak).toBeLessThanOrEqual(STRATEGY_BATCH_CONCURRENCY); // ...but never past the cap
  });

  it("one failed batch fails the whole step visibly (runStep reports ok=false with the read's name)", async () => {
    const client = new FakeSupabaseClient(history(3, 2));
    client.failTable("content_scores", { message: "statement timeout" });

    await expect(collectStrategyEngineInputs(asSupabase(client), now)).rejects.toBeInstanceOf(StrategyCollectionError);

    const step = await runStep("strategy_evolution", async () => {
      await collectStrategyEngineInputs(asSupabase(client), now);
      return "generated";
    });
    expect(step.ok).toBe(false);
    expect(step.detail).toBe('strategy input query "content_scores" failed: statement timeout');
  });

  it("still fails visibly when the very first (campaigns) read breaks", async () => {
    const client = new FakeSupabaseClient(history(1, 1));
    client.failTable("campaigns", { message: "relation missing" });

    await expect(collectStrategyEngineInputs(asSupabase(client), now)).rejects.toThrow('strategy input query "campaigns" failed: relation missing');
  });
});
