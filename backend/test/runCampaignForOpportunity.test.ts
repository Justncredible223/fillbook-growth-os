import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { CampaignFactory } from "../src/content/campaignFactory";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import { InMemoryContentScoreRepository } from "../src/content/contentScoreRepository";
import { assetTypeForManualRequest, runCampaignForOpportunity, type RunCampaignDeps } from "../src/content/runCampaignForOpportunity";
import type { CampaignRepository } from "../src/content/campaignPipeline";
import type { AssetStage } from "../src/content/campaignFactory";

const opportunity = {
  id: "opp-1",
  title: "Real signal",
  rationale: "real evidence",
  recommendedChannels: ["x"],
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function draftResponse(body: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_draft", input: { body } }] });
}
function verdictResponse(pass: boolean) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_verdict", input: { pass, score: pass ? 1 : 0.2, reasoning: "ok", issues: [] } }] });
}

class InMemoryCampaignRepository implements CampaignRepository {
  assets: Array<{ id: string; assetType: string; stage: AssetStage }> = [];
  private counter = 0;
  async createCampaign() { return `campaign-${++this.counter}`; }
  async createCampaignAsset(_campaignId: string, _platform: string, assetType: string) {
    const id = `asset-${++this.counter}`;
    this.assets.push({ id, assetType, stage: "draft" });
    return id;
  }
  async insertContentVersion() { return `version-${++this.counter}`; }
  async updateAssetStage(id: string, stage: AssetStage) {
    const asset = this.assets.find((a) => a.id === id);
    if (asset) asset.stage = stage;
  }
}

function videoScriptResponse() {
  return jsonResponse({
    content: [
      {
        type: "tool_use",
        name: "submit_video_script",
        input: {
          hook: "Trailing drawdown can pull a funded account while winning.",
          script: "Trailing drawdown can pull a funded account while winning. Here's why.",
          shotList: ["Fillbook UI: example rule alert (demo data)"],
          youtubeTitle: "Why Funded Accounts Get Pulled Even When Winning",
          youtubeDescription: "Trailing drawdown explained.",
          tiktokCaption: "Trailing drawdown explained.",
          hashtags: ["futurestrading"],
          disclosureCta: null,
        },
      },
    ],
  });
}

function buildDeps(fetchMock: ReturnType<typeof vi.fn>, overrides: Partial<RunCampaignDeps> = {}) {
  const rules = [
    {
      id: "r1",
      version: 1,
      ruleType: "claim_prohibited" as const,
      content: "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.",
      sourceDoc: null,
      isActive: true,
    },
  ];
  const gate = new ContentQualityGate(new BrandConstitution(new InMemoryBrandConstitutionRepository(rules)));
  const llmClient = new LlmClient("test-key", fetchMock);
  const deps: RunCampaignDeps = {
    llmClient,
    factory: new CampaignFactory(gate),
    scoreRepo: new InMemoryContentScoreRepository(),
    campaignRepo: new InMemoryCampaignRepository(),
    brandRulesSummary: "",
    verifiedKnowledgeSummary: "",
    recentTextsForSameTopic: [],
    markOpportunityActioned: vi.fn().mockResolvedValue(undefined),
    markCampaignInReview: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return deps;
}

describe("runCampaignForOpportunity", () => {
  it("calls markOpportunityActioned and markCampaignInReview ONLY when the pipeline reaches ready_for_owner", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, opportunity);

    expect(result.finalStage).toBe("ready_for_owner");
    expect(deps.markOpportunityActioned).toHaveBeenCalledWith("opp-1");
    expect(deps.markCampaignInReview).toHaveBeenCalledWith(result.campaignId);
  });

  it("does NOT call either status-update callback when the draft fails review (auto-generated is not auto-approved)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(false));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, opportunity);

    expect(result.finalStage).toBe("final_draft");
    expect(deps.markOpportunityActioned).not.toHaveBeenCalled();
    expect(deps.markCampaignInReview).not.toHaveBeenCalled();
  });

  it("never reaches a stage beyond ready_for_owner -- no code path publishes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, opportunity);

    expect(["draft", "final_draft", "ready_for_owner"]).toContain(result.finalStage);
    expect(result.finalStage).not.toBe("handed_off");
  });

  /**
   * Regression coverage (2026-09-08): the owner-requested video-script
   * feature threads options.assetTypeOverride from this function's third
   * parameter down into the pipeline's context -- confirms it actually
   * reaches campaignPipeline.ts and produces a real video_script asset
   * even for a non-video-platform opportunity (recommendedChannels: ["x"]
   * here, same fixture every other test in this file uses unmodified).
   */
  it("creates a video_script asset when options.assetTypeOverride is 'video_script', even for a non-video-platform opportunity", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, opportunity, { assetTypeOverride: "video_script" });

    expect(result.finalStage).toBe("ready_for_owner");
    expect(result.draftText).toContain("SHOT LIST:");
    expect((deps.campaignRepo as InMemoryCampaignRepository).assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe(
      "video_script",
    );
  });

  it("omitting options entirely preserves the exact prior behavior -- a plain text post, not a video script", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(draftResponse("Most funded accounts get pulled for violating a rule nobody reads twice."))
      .mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, opportunity);

    expect((deps.campaignRepo as InMemoryCampaignRepository).assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe(
      "post",
    );
  });
});

describe("a 'Video request:' opportunity always runs as a video (owner report 2026-09-21)", () => {
  const videoRequest = {
    id: "opp-video",
    title: "Video request: why prop firm traders who track their trades get funded",
    rationale: 'Owner-requested video topic, entered directly in the app: "why prop firm traders who track their trades get funded"',
    recommendedChannels: [] as string[],
  };
  const assetTypeOf = (deps: RunCampaignDeps, id: string) => (deps.campaignRepo as InMemoryCampaignRepository).assets.find((a) => a.id === id)?.assetType;

  it("drafts a video script when run with no options -- the plain Radar run and the daily auto-draft both call it this way", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);

    const result = await runCampaignForOpportunity(deps, videoRequest);

    expect(assetTypeOf(deps, result.campaignAssetId)).toBe("video_script");
    expect(result.draftText).toContain("SHOT LIST:");
  });

  it("an explicit override from the caller still wins", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);
    const result = await runCampaignForOpportunity(deps, videoRequest, { assetTypeOverride: "video_script" });
    expect(assetTypeOf(deps, result.campaignAssetId)).toBe("video_script");
  });

  it("an ordinary opportunity is still a plain post", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(draftResponse("Funded accounts get pulled for rules nobody rereads.")).mockResolvedValue(verdictResponse(true));
    const deps = buildDeps(fetchMock);
    const result = await runCampaignForOpportunity(deps, { ...opportunity, title: "Traders confused about drawdown" });
    expect(assetTypeOf(deps, result.campaignAssetId)).toBe("post");
  });

  it("assetTypeForManualRequest only matches the exact request prefix", () => {
    expect(assetTypeForManualRequest("Video request: anything")).toBe("video_script");
    expect(assetTypeForManualRequest("Research request: anything")).toBeUndefined();
    expect(assetTypeForManualRequest("A video request: anything")).toBeUndefined();
    expect(assetTypeForManualRequest("video request: lowercase prefix")).toBeUndefined();
  });
});
