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

function researchResponse() {
  return jsonResponse({
    content: [
      {
        type: "tool_use",
        name: "submit_research",
        input: {
          title: "Trailing drawdown confusion among funded traders",
          question: "Do funded traders understand how trailing drawdown is calculated?",
          summary: "Many funded traders misunderstand trailing drawdown mechanics, especially around EOD balance-based calculations.",
          findings: ["Trailing drawdown is commonly confused with a fixed daily loss limit."],
          evidenceReferences: ["Fillbook prop-firm drawdown tracking doc"],
          caveats: ["General trading-domain reasoning, not verified against Fillbook's own knowledge base."],
          contentAngles: ["A short explainer comparing trailing vs static drawdown."],
        },
      },
    ],
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
          youtubeTitle: "Why Funded Accounts Get Pulled Even When Winning",
          youtubeDescription: "Trailing drawdown explained.",
          tiktokCaption: "Trailing drawdown explained.",
          hashtags: ["futurestrading", "propfirm"],
          disclosureCta: null,
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

  it("drafts a real video script for a NON-video-platform opportunity when the owner explicitly requests assetTypeOverride: 'video_script'", async () => {
    // Regression coverage (2026-09-08): the TikTok/YouTube signal adapters
    // that used to produce video-first opportunities were intentionally
    // removed (see api/ingest.ts's own doc comment), so relying on
    // VIDEO_PLATFORMS.has(platform) alone left this path permanently
    // unreachable. The owner can now request a video script for ANY open
    // opportunity via api/run-campaign.ts's validated assetType field,
    // which threads through as context.assetTypeOverride here.
    const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();
    // Deliberately NOT a video platform -- recommendedChannels is "x", same
    // as the module-level `opportunity` fixture used by every other test.
    expect(opportunity.recommendedChannels).toEqual(["x"]);

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, {
      ...context,
      assetTypeOverride: "video_script",
    });

    expect(result.platform).toBe("x");
    expect(result.draftText).toContain("HOOK:");
    expect(result.draftText).toContain("SHOT LIST:");
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("video_script");
    expect(result.finalStage).toBe("ready_for_owner");
  });

  it("does NOT draft a video script for a non-video-platform opportunity when assetTypeOverride is omitted -- preserves existing normal-campaign behavior exactly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, context);

    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("post");
    expect(result.draftText).not.toContain("SHOT LIST:");
  });

  it("drafts a research report and skips the deep-review agents entirely when assetTypeOverride is 'research'", async () => {
    // Only ONE fetch call expected -- the draft call -- proving the nine
    // review agents genuinely never run for research (unlike video/text,
    // which call the review agents after a passing mechanical gate).
    const fetchMock = vi.fn().mockResolvedValueOnce(researchResponse());
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, {
      ...context,
      assetTypeOverride: "research",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.mechanicalGatePassed).toBe(true);
    expect(result.deepReview).toBeNull();
    expect(result.finalStage).toBe("ready_for_owner");
    expect(scoreRepo.saved).toHaveLength(0);
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("research");
    expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.stage).toBe("ready_for_owner");

    expect(result.draftText).toContain("TITLE:");
    expect(result.draftText).toContain("KEY FINDINGS:");

    const version = campaignRepo.versions.find((v) => v.campaignAssetId === result.campaignAssetId);
    expect((version?.metadata.research as { title: string } | undefined)?.title).toBe(
      "Trailing drawdown confusion among funded traders",
    );
  });

  it("stops a research draft at the mechanical gate (still runs, unlike deep review) and never reaches ready_for_owner", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        content: [
          {
            type: "tool_use",
            name: "submit_research",
            input: {
              title: "x",
              question: "x",
              summary: "x",
              findings: ["When I traded NQ today I caught a great move."],
              evidenceReferences: [],
              caveats: ["unverified"],
              contentAngles: ["x"],
            },
          },
        ],
      }),
    );
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, {
      ...context,
      assetTypeOverride: "research",
    });

    expect(result.mechanicalGatePassed).toBe(false);
    expect(result.deepReview).toBeNull();
    expect(result.finalStage).toBe("draft");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells the writer and every review agent this is a reply when the opportunity has a sourceUrl", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Not yet -- most traders think another spreadsheet will fix it."))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();
    const mentionOpportunity = { ...opportunity, sourceUrl: "https://x.com/someone/status/123", authorHandle: "someone" };

    const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, mentionOpportunity, context);

    expect(result.finalStage).toBe("ready_for_owner");

    const draftCallBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(draftCallBody.messages[0].content).toContain("REPLY, not a standalone post");
    expect(draftCallBody.messages[0].content).toContain("@someone");

    for (const call of fetchMock.mock.calls.slice(1)) {
      const body = JSON.parse(call[1]!.body as string);
      expect(body.messages[0].content).toContain("this is a REPLY to a real X user's mention");
    }
  });

  it("threads the recipient's real evidence excerpts to BOTH the writer and every review agent for a partnership pitch -- not just the recipient name", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Fillbook is a broker-agnostic futures trading journal -- a natural fit for a guided journaling pilot."))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();
    const pitchContext = {
      ...context,
      contentFormat: "partnership_pitch" as const,
      pitchRecipientOrganization: "Apex Journaling Coach",
      pitchChannel: "email" as const,
      pitchEvidenceExcerpts: ["We run a 6-week risk-management cohort for funded futures traders."],
    };

    await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, pitchContext);

    const draftCallBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(draftCallBody.messages[0].content).toContain("6-week risk-management cohort");

    for (const call of fetchMock.mock.calls.slice(1)) {
      const body = JSON.parse(call[1]!.body as string);
      expect(body.messages[0].content).toContain("6-week risk-management cohort");
    }
  });

  it("does not mention reply format for a normal content opportunity with no sourceUrl", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const client = new LlmClient("test-key", fetchMock);
    const campaignRepo = new InMemoryCampaignRepository();
    const scoreRepo = new InMemoryContentScoreRepository();

    await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, opportunity, context);

    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(call[1]!.body as string);
      expect(body.messages[0].content).not.toContain("REPLY");
    }
  });
});
