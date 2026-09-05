import type { LlmClient } from "./llmClient.js";
import { CampaignFactory, type AssetStage } from "./campaignFactory.js";
import type { ContentScoreRepository } from "./contentScoreRepository.js";
import type { DeepReviewResult } from "./deepReviewGate.js";
import { draftContent } from "./contentWriter.js";
import { draftVideoScript, formatVideoScriptAsText, type VideoScript } from "./videoScriptWriter.js";

/**
 * Platforms whose native format is short-form video, not a text post --
 * these get a real shootable production package (hook/script/shot
 * list/caption/hashtags) from videoScriptWriter instead of a single
 * platform-native post from contentWriter. See docs/VIDEO_FACTORY.md.
 */
const VIDEO_PLATFORMS = new Set(["tiktok"]);

export interface PipelineOpportunity {
  id: string;
  title: string;
  rationale: string;
  recommendedChannels: string[];
  /** See Opportunity.sourceUrl's kdoc -- presence means this is a reply-worthy X mention, not a content/campaign opportunity. */
  sourceUrl?: string;
  authorHandle?: string;
}

export interface CampaignRepository {
  createCampaign(opportunityId: string, thesis: string): Promise<string>;
  createCampaignAsset(campaignId: string, platform: string, assetType: string): Promise<string>;
  /**
   * metadata is optional and additive -- text posts never set it. Video
   * assets store the structured VideoScript here (not just re-parsed from
   * `body`) so downstream consumers -- the video-factory CLI in
   * particular -- get reliable structured fields instead of re-parsing
   * formatVideoScriptAsText's human-readable text block.
   */
  insertContentVersion(campaignAssetId: string, version: number, body: string, metadata?: Record<string, unknown>): Promise<string>;
  updateAssetStage(campaignAssetId: string, stage: AssetStage): Promise<void>;
}

export interface PipelineContext {
  brandRulesSummary: string;
  verifiedKnowledgeSummary: string;
  recentTextsForSameTopic: string[];
  /**
   * Overrides the asset_type this run creates -- defaults to the
   * existing "video_script" (video platforms) / "post" (everything
   * else) inference when omitted, so every existing caller (manual
   * /api/run-campaign, auto-draft) is unaffected. Used by the daily X
   * feed-post step to mark its output with a distinct, dedicated
   * asset_type (X_FEED_POST_ASSET_TYPE) instead of the generic "post"
   * value replies/opportunity-drafts already use -- see
   * dailyXFeedPost.ts's own doc comment for why that distinction is
   * what keeps Home's Today's X Post genuinely separate from replies.
   */
  assetTypeOverride?: string;
  /**
   * Tells the deep-review agents what shape of content this actually is,
   * beyond the existing post/reply distinction -- a partnership pitch is
   * a third shape (a private, one-recipient business proposition, not
   * public content), and judging it with the wrong bar (e.g.
   * hook_specialist expecting a scroll-stopping public hook) produces
   * wrong verdicts. Omitted defaults to the existing isReply-based
   * post/reply distinction, so every existing caller is unaffected.
   */
  contentFormat?: "post" | "reply" | "partnership_pitch";
  /** Only meaningful when contentFormat is "partnership_pitch" -- who this specific pitch is addressed to, so growth_strategist can judge recipient-specific relevance rather than a generic audience bar. */
  pitchRecipientOrganization?: string;
  /** Only meaningful when contentFormat is "partnership_pitch" -- which channel this will actually be sent through, so hook_specialist judges an email subject/opener vs an X DM opener appropriately. */
  pitchChannel?: "email" | "x";
  /** Only meaningful when contentFormat is "partnership_pitch" -- the recipient's OWN real words, given to both the writer (for personalization) and every reviewer (for specificity/fact-claim verification). See reviewAgents.ts's own doc comment for why this closed a real gap. */
  pitchEvidenceExcerpts?: string[];
  /** Only meaningful when contentFormat is "partnership_pitch" -- a prior failed attempt's own review-gate feedback, passed to the writer on a bounded revision retry so a rewrite targets the ACTUAL rejection reasons instead of guessing again from scratch. */
  pitchPriorFeedback?: string;
}

export interface PipelineResult {
  campaignId: string;
  campaignAssetId: string;
  platform: string;
  draftText: string;
  mechanicalGatePassed: boolean;
  mechanicalBlockReasons: string[];
  deepReview: DeepReviewResult | null;
  finalStage: AssetStage;
}

/**
 * The end-to-end Opportunity -> draft -> mechanical gate -> deep review ->
 * ready_for_owner pipeline. Every ingredient here already existed
 * separately (ContentWriter, ContentQualityGate via CampaignFactory,
 * the nine review agents) -- this is just the orchestration that was
 * missing to turn them into one real run. It never calls
 * handOffToOwner/EXTERNAL_DRAFT -- the furthest stage this can reach is
 * 'ready_for_owner', same as every other path into CampaignFactory.
 */
export async function runCampaignPipeline(
  llmClient: LlmClient,
  factory: CampaignFactory,
  scoreRepo: ContentScoreRepository,
  campaignRepo: CampaignRepository,
  opportunity: PipelineOpportunity,
  context: PipelineContext,
): Promise<PipelineResult> {
  const platform = opportunity.recommendedChannels[0] ?? "x";
  const isVideo = VIDEO_PLATFORMS.has(platform);
  // Same signal the Android app uses to tell an "engagement" opportunity
  // from a "campaign/content" one -- never inferred from title text.
  const isReply = Boolean(opportunity.sourceUrl);
  let draftText: string;
  let videoScript: VideoScript | null = null;
  if (isVideo) {
    videoScript = await draftVideoScript(llmClient, opportunity, context.brandRulesSummary, context.verifiedKnowledgeSummary);
    draftText = formatVideoScriptAsText(videoScript);
  } else {
    draftText = await draftContent(
      llmClient,
      platform,
      opportunity,
      context.brandRulesSummary,
      context.verifiedKnowledgeSummary,
      isReply ? { authorHandle: opportunity.authorHandle ?? null } : undefined,
      context.contentFormat === "partnership_pitch" && context.pitchRecipientOrganization && context.pitchChannel
        ? {
            recipientOrganization: context.pitchRecipientOrganization,
            channel: context.pitchChannel,
            evidenceExcerpts: context.pitchEvidenceExcerpts ?? [],
            proposedCollaboration: opportunity.rationale,
            priorFeedback: context.pitchPriorFeedback,
          }
        : undefined,
    );
  }

  const campaignId = await campaignRepo.createCampaign(opportunity.id, opportunity.title);
  const campaignAssetId = await campaignRepo.createCampaignAsset(campaignId, platform, context.assetTypeOverride ?? (isVideo ? "video_script" : "post"));
  const contentVersionId = await campaignRepo.insertContentVersion(
    campaignAssetId,
    1,
    draftText,
    videoScript ? { videoScript } : undefined,
  );

  const mechanical = await factory.submitDraft("draft", draftText, context.recentTextsForSameTopic);
  await campaignRepo.updateAssetStage(campaignAssetId, mechanical.newStage);

  if (!mechanical.advanced) {
    return {
      campaignId,
      campaignAssetId,
      platform,
      draftText,
      mechanicalGatePassed: false,
      mechanicalBlockReasons: mechanical.blockReasons,
      deepReview: null,
      finalStage: mechanical.newStage,
    };
  }

  const deepReview = await factory.runAndRecordDeepReview(llmClient, scoreRepo, contentVersionId, draftText, {
    platform,
    brandRulesSummary: context.brandRulesSummary,
    verifiedKnowledgeSummary: context.verifiedKnowledgeSummary,
    isReply,
    contentFormat: context.contentFormat,
    pitchRecipientOrganization: context.pitchRecipientOrganization,
    pitchChannel: context.pitchChannel,
    pitchEvidenceExcerpts: context.pitchEvidenceExcerpts,
  });

  if (!deepReview.passed) {
    return {
      campaignId,
      campaignAssetId,
      platform,
      draftText,
      mechanicalGatePassed: true,
      mechanicalBlockReasons: [],
      deepReview,
      finalStage: mechanical.newStage,
    };
  }

  const readyStage = factory.markReadyForOwner(mechanical.newStage);
  await campaignRepo.updateAssetStage(campaignAssetId, readyStage);

  return {
    campaignId,
    campaignAssetId,
    platform,
    draftText,
    mechanicalGatePassed: true,
    mechanicalBlockReasons: [],
    deepReview,
    finalStage: readyStage,
  };
}
