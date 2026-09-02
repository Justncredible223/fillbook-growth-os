import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { CampaignFactory } from "../src/content/campaignFactory";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import { InMemoryContentScoreRepository } from "../src/content/contentScoreRepository";
import { runCampaignPipeline, type CampaignRepository } from "../src/content/campaignPipeline";
import type { BrandRule } from "../src/knowledge/types";
import type { AssetStage } from "../src/content/campaignFactory";

const rules: BrandRule[] = [
  {
    id: "r1",
    version: 1,
    ruleType: "claim_prohibited",
    content: "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.",
    sourceDoc: null,
    isActive: true,
  },
];

const opportunity = {
  id: "opp-1",
  title: "Trailing drawdown rules confuse traders",
  rationale: "High audience relevance, strong Fillbook fit.",
  recommendedChannels: ["x"],
};

const context = {
  brandRulesSummary: "voice: concise",
  verifiedKnowledgeSummary: "Fillbook tracks prop-firm drawdown rules.",
  recentTextsForSameTopic: [] as string[],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function draftResponse(body: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_draft", input: { body } }] });
}

function verdictResponse(pass: boolean, reasoning = "ok") {
  return jsonResponse({
    content: [{ type: "tool_use", name: "submit_verdict", input: { pass, score: pass ? 1 : 0.2, reasoning, issues: [] } }],
  });
}

function videoScriptResponse() {
  return jsonResponse({
    content: [
      {
        type: "tool_use",
        name: "submit_video_script",
        input: {
          hook: "Your funded account can get pulled even on a winning trade.",
          script: "Your funded account can get pulled even on a winning trade. Here's why.",
          shotList: ["Text card: the hook", "Fillbook UI: example drawdown chart (demo data)"],
          caption: "Trailing drawdown explained.",
          hashtags: ["futurestrading", "propfirm"],
        },
      },
    ],
  });
}

class InMemoryCampaignRepository implements CampaignRepository {
  campaigns: Array<{ id: string; opportunityId: string; thesis: string }> = [];
  assets: Array<{ id: string; campaignId: string; platform: string; assetType: string; stage: AssetStage }> = [];
  versions: Array<{ id: string; campaignAssetId: string; version: number; body: string; metadata: Record<string, unknown> }> = [];
  private counter = 0;

  async createCampaign(opportunityId: string, thesis: string) {
    const id = `campaign-${++this.counter}`;
    this.campaigns.push({ id, opportunityId, thesis });
    return id;
  }
  async createCampaignAsset(campaignId: string, platform: string, assetType: string) {
    const id = `asset-${++this.counter}`;
    this.assets.push({ id, campaignId, platform, assetType, stage: "draft" });
    return id;
  }
  async insertContentVersion(campaignAssetId: string, version: number, body: string, metadata: Record<string, unknown> = {}) {
    const id = `version-${++this.counter}`;
    this.versions.push({ id, campaignAssetId, version, body, metadata });
    return id;
  }
  async updateAssetStage(campaignAssetId: string, stage: AssetStage) {
    const asset = this.assets.find((a) => a.id === campaignAssetId);
    if (asset) asset.stage = stage;
  }
}

function buildFactory() {
  const gate = new ContentQualityGate(new BrandConstitution(new InMemoryBrandConstitutionRepository(rules)));
  return new CampaignFactory(gate);
}

describe("runCampaignPipeline", () => {
  it("reaches ready_for_owner when both gates pass", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, context);

    expect(result.mechanicalGatePassed).toBe(true);
    expect(result.deepReview?.passed).toBe(true);
    expect(result.finalStage).toBe("ready_for_owner");
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.stage).toBe("ready_for_owner");
    expect(scoreRepo.saved.length).toBeGreaterThan(0);
  });

  it("stops at the mechanical gate and never calls the deep-review agents", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(draftResponse("When I traded NQ today I caught a great move."));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, context);

    expect(result.mechanicalGatePassed).toBe(false);
    expect(result.deepReview).toBeNull();
    expect(result.finalStage).toBe("draft");
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the draft call, no review agents
    expect(scoreRepo.saved).toHaveLength(0);
  });

  it("passes the mechanical gate but stays at final_draft when a deep-review agent fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValueOnce(verdictResponse(true))
      .mockResolvedValueOnce(verdictResponse(false, "unverified claim"))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, context);

    expect(result.mechanicalGatePassed).toBe(true);
    expect(result.deepReview?.passed).toBe(false);
    expect(result.finalStage).toBe("final_draft");
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.stage).toBe("final_draft");
  });

  it("drafts a real video script (not a text post) for a video platform like tiktok", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();
    const videoOpportunity = { ...opportunity, recommendedChannels: ["tiktok"] };

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, videoOpportunity, context);

    expect(result.platform).toBe("tiktok");
    expect(result.draftText).toContain("HOOK:");
    expect(result.draftText).toContain("SHOT LIST:");
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("video_script");
    expect(result.finalStage).toBe("ready_for_owner");

    const version = campaignRepo.versions.find((v) => v.campaignAssetId === result.campaignAssetId);
    expect((version?.metadata.videoScript as { hook: string } | undefined)?.hook).toBe(
      "Your funded account can get pulled even on a winning trade.",
    );
  });
});
