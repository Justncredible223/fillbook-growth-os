import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { CampaignFactory } from "../src/content/campaignFactory";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import { InMemoryContentScoreRepository } from "../src/content/contentScoreRepository";
import { runCampaignForOpportunity, type RunCampaignDeps } from "../src/content/runCampaignForOpportunity";
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
  assets: Array<{ id: string; stage: AssetStage }> = [];
  private counter = 0;
  async createCampaign() { return `campaign-${++this.counter}`; }
  async createCampaignAsset() {
    const id = `asset-${++this.counter}`;
    this.assets.push({ id, stage: "draft" });
    return id;
  }
  async insertContentVersion() { return `version-${++this.counter}`; }
  async updateAssetStage(id: string, stage: AssetStage) {
    const asset = this.assets.find((a) => a.id === id);
    if (asset) asset.stage = stage;
  }
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
});
