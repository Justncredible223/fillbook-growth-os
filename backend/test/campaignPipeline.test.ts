import { describe, it, expect, vi } from "vitest";
import { LlmClient } from "../src/content/llmClient";
import { CampaignFactory } from "../src/content/campaignFactory";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import { InMemoryContentScoreRepository } from "../src/content/contentScoreRepository";
import { runCampaignPipeline, type CampaignRepository } from "../src/content/campaignPipeline";
import { assetTypeForManualRequest } from "../src/content/runCampaignForOpportunity";
import type { BrandRule } from "../src/knowledge/types";
import type { AssetStage } from "../src/content/campaignFactory";
import { PILOT_2 } from "../src/shortform/pilots";
import { computeScenePlanHash } from "../src/shortform/scenePlan";
import { MOTION_CONCEPT_REF_PREFIX, resolveMotionScenePlan } from "../scripts/video-factory/motionCatalog";

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
          hook: "Trailing drawdown can pull a funded account while winning.",
          script: "Trailing drawdown can pull a funded account while winning. Here's why.",
          shotList: ["Fillbook UI: example rule alert (demo data)", "Fillbook UI: example drawdown chart (demo data)"],
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
      "Trailing drawdown can pull a funded account while winning.",
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

  describe("motion-backed concept requests (2026-09-23)", () => {
    it("builds the video script DIRECTLY from the verified ScenePlan (no drafting LLM call) when the opportunity's rationale carries a motion-concept reference, and the stored videoScript resolves correctly at render time", async () => {
      // No draftResponse mocked at all -- only verdicts. If campaignPipeline
      // called draftVideoScript (the LLM path) instead of
      // buildVideoScriptFromScenePlan, the first fetch would hit this
      // verdict-shaped mock as if it were a draft response and fail loudly,
      // proving this path genuinely skips the LLM drafting call.
      const fetchMock = vi.fn().mockResolvedValue(verdictResponse(true));
      const client = new LlmClient("test-key", fetchMock);
      const campaignRepo = new InMemoryCampaignRepository();
      const scoreRepo = new InMemoryContentScoreRepository();
      const motionOpportunity = {
        ...opportunity,
        title: "Motion concept request: Balance isn't your buffer.",
        rationale: `Owner-requested motion-backed video concept, entered directly in the app: "Balance isn't your buffer.". ${MOTION_CONCEPT_REF_PREFIX}${PILOT_2.planId}`,
      };

      const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, motionOpportunity, {
        ...context,
        assetTypeOverride: "video_script",
      });

      expect(result.finalStage).toBe("ready_for_owner");
      expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("video_script");
      expect(result.draftText).toContain(PILOT_2.hook);

      const version = campaignRepo.versions.find((v) => v.campaignAssetId === result.campaignAssetId);
      const storedVideoScript = version?.metadata.videoScript as
        | { hook: string; script: string; motionScenePlan?: { scenePlanId: string; scenePlanHash: string } | null }
        | undefined;
      expect(storedVideoScript?.hook).toBe(PILOT_2.hook);
      expect(storedVideoScript?.motionScenePlan?.scenePlanId).toBe(PILOT_2.planId);
      expect(storedVideoScript?.motionScenePlan?.scenePlanHash).toBe(computeScenePlanHash(PILOT_2));

      // The generation-to-render chain, end to end: what got stored resolves
      // to exactly PILOT_2, using ONLY the explicit reference -- never the
      // (also-matching, but that's not why it resolves) hook text alone.
      const resolved = resolveMotionScenePlan(storedVideoScript!);
      expect(resolved.plan?.planId).toBe(PILOT_2.planId);
    });

    it("a motion-concept opportunity re-run WITHOUT an explicit assetTypeOverride (Radar re-run / daily auto-draft) is still labeled video_script, so approving it actually queues a render", async () => {
      const fetchMock = vi.fn().mockResolvedValue(verdictResponse(true));
      const client = new LlmClient("test-key", fetchMock);
      const campaignRepo = new InMemoryCampaignRepository();
      const scoreRepo = new InMemoryContentScoreRepository();
      const motionOpportunity = {
        ...opportunity,
        recommendedChannels: [] as string[],
        title: "Motion concept request: Balance isn't your buffer.",
        rationale: `Owner-requested motion-backed video concept, entered directly in the app: "Balance isn't your buffer.". ${MOTION_CONCEPT_REF_PREFIX}${PILOT_2.planId}`,
      };

      // No assetTypeOverride at all -- as when auto-draft or a plain Radar run picks it up.
      const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, motionOpportunity, context);

      expect(campaignRepo.assets.find((a) => a.id === result.campaignAssetId)?.assetType).toBe("video_script");
      const version = campaignRepo.versions.find((v) => v.campaignAssetId === result.campaignAssetId);
      expect((version?.metadata.videoScript as { motionScenePlan?: { scenePlanId: string } } | undefined)?.motionScenePlan?.scenePlanId).toBe(PILOT_2.planId);
    });

    it("assetTypeForManualRequest treats a motion-concept title as a video request (runCampaignForOpportunity's own fallback)", () => {
      expect(assetTypeForManualRequest("Motion concept request: Balance isn't your buffer.")).toBe("video_script");
      expect(assetTypeForManualRequest("Video request: some topic")).toBe("video_script");
      expect(assetTypeForManualRequest("Trailing drawdown rules confuse traders")).toBeUndefined();
    });

    it("an ordinary CUSTOM-TOPIC opportunity whose owner-typed text happens to literally contain a MOTION_CONCEPT_REF marker does NOT activate motion mode -- title prefix, not rationale text alone, gates it", async () => {
      // manualVideoTopicOpportunityInput embeds the owner's own typed text
      // verbatim inside `rationale` -- if the owner typed (or pasted) a
      // topic that happened to contain the literal marker string, the
      // rationale substring match alone would wrongly activate motion
      // mode. The title always carries "Video request: " for this flow
      // (manualVideoTopicTitle), never "Motion concept request: ", so this
      // must still draft a normal LLM video script.
      const fetchMock = vi.fn().mockResolvedValueOnce(videoScriptResponse()).mockResolvedValue(verdictResponse(true));
      const client = new LlmClient("test-key", fetchMock);
      const campaignRepo = new InMemoryCampaignRepository();
      const scoreRepo = new InMemoryContentScoreRepository();
      const trickyOpportunity = {
        ...opportunity,
        title: "Video request: some topic",
        rationale: `Owner-requested video topic, entered directly in the app: "some topic mentioning ${MOTION_CONCEPT_REF_PREFIX}${PILOT_2.planId} by coincidence"`,
      };

      const result = await runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, trickyOpportunity, {
        ...context,
        assetTypeOverride: "video_script",
      });

      // Drafted via the normal LLM path (videoScriptResponse's own fixed hook), not PILOT_2's.
      expect(result.draftText).toContain("Trailing drawdown can pull a funded account while winning.");
      const version = campaignRepo.versions.find((v) => v.campaignAssetId === result.campaignAssetId);
      const storedVideoScript = version?.metadata.videoScript as { motionScenePlan?: unknown } | undefined;
      expect(storedVideoScript?.motionScenePlan).toBeUndefined();
    });

    it("refuses to draft (never falls back to the LLM, never renders) when the motion concept id is unknown", async () => {
      const fetchMock = vi.fn();
      const client = new LlmClient("test-key", fetchMock);
      const campaignRepo = new InMemoryCampaignRepository();
      const scoreRepo = new InMemoryContentScoreRepository();
      const badOpportunity = {
        ...opportunity,
        title: "Motion concept request: some unknown concept",
        rationale: `${MOTION_CONCEPT_REF_PREFIX}pilot-does-not-exist`,
      };

      await expect(
        runCampaignPipeline(client, buildFactory(), scoreRepo, campaignRepo, badOpportunity, { ...context, assetTypeOverride: "video_script" }),
      ).rejects.toThrow(/not a known verified ScenePlan/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(campaignRepo.assets).toHaveLength(0);
    });
  });
});
