import { authorizeAndAudit, type AuditSink } from "../firewall/externalWriteFirewall.js";
import { ContentQualityGate } from "./contentQualityGate.js";
import type { LlmClient } from "./llmClient.js";
import { runDeepReview, ALL_REVIEW_AGENTS, type DeepReviewResult } from "./deepReviewGate.js";
import type { ReviewAgentName, ReviewContext } from "./reviewAgents.js";
import type { ContentScoreRepository } from "./contentScoreRepository.js";

export type AssetStage =
  | "idea"
  | "evidence_packet"
  | "thesis"
  | "angle"
  | "hook_competition"
  | "outline"
  | "draft"
  | "platform_adaptation"
  | "factual_verification"
  | "brand_verification"
  | "originality_review"
  | "anti_slop_review"
  | "policy_review"
  | "conversion_review"
  | "final_draft"
  | "ready_for_owner"
  | "handed_off";

export const STAGE_ORDER: AssetStage[] = [
  "idea",
  "evidence_packet",
  "thesis",
  "angle",
  "hook_competition",
  "outline",
  "draft",
  "platform_adaptation",
  "factual_verification",
  "brand_verification",
  "originality_review",
  "anti_slop_review",
  "policy_review",
  "conversion_review",
  "final_draft",
  "ready_for_owner",
  "handed_off",
];

export interface SubmitDraftResult {
  advanced: boolean;
  newStage: AssetStage;
  blockReasons: string[];
}

/**
 * Orchestrates a campaign asset through the content pipeline. Nothing in
 * this class can reach a published state — 'handed_off' means "opened the
 * platform's own composer / staged the file for the owner", enforced by
 * always calling the firewall with EXTERNAL_DRAFT, never EXTERNAL_WRITE.
 * There is no method on this class that accepts an action class parameter
 * from the caller — that is intentional, not an oversight, matching
 * ExternalWriteFirewall's "no override" invariant.
 */
export class CampaignFactory {
  constructor(
    private qualityGate: ContentQualityGate,
    private auditSink: AuditSink = () => {},
  ) {}

  /**
   * Runs the mechanical quality gate against a draft. Only advances to
   * 'final_draft' if it passes; otherwise stays at 'draft' (or whatever
   * stage was passed in) with the reasons so the caller can regenerate.
   */
  async submitDraft(
    currentStage: AssetStage,
    candidateText: string,
    recentTextsForSameTopic: string[],
  ): Promise<SubmitDraftResult> {
    const result = await this.qualityGate.check(candidateText, recentTextsForSameTopic);
    if (!result.passed) {
      return { advanced: false, newStage: currentStage, blockReasons: result.blockReasons };
    }
    return { advanced: true, newStage: "final_draft", blockReasons: [] };
  }

  /**
   * Marks a final_draft as ready for the owner to review. Requires the
   * asset to actually be at 'final_draft' — cannot skip stages.
   */
  markReadyForOwner(currentStage: AssetStage): AssetStage {
    if (currentStage !== "final_draft") {
      throw new Error(
        `Cannot mark ready_for_owner from stage "${currentStage}" — must pass through final_draft first.`,
      );
    }
    return "ready_for_owner";
  }

  /**
   * Additive: runs the nine LLM deep-review agents (Phase 6, requires
   * ANTHROPIC_API_KEY) and persists every verdict to content_scores,
   * regardless of pass/fail -- the audit trail matters as much as the
   * gate. Does not change submitDraft's mechanical-only behavior; a
   * caller with no AI provider key configured never has to touch this
   * method at all.
   */
  async runAndRecordDeepReview(
    client: LlmClient,
    scoreRepo: ContentScoreRepository,
    contentVersionId: string,
    candidateText: string,
    context: ReviewContext,
    agents: ReviewAgentName[] = ALL_REVIEW_AGENTS,
  ): Promise<DeepReviewResult> {
    const result = await runDeepReview(client, agents, candidateText, context);
    for (const verdict of result.verdicts) {
      await scoreRepo.save(contentVersionId, verdict);
    }
    return result;
  }

  /**
   * The only way an asset reaches 'handed_off'. This is EXTERNAL_DRAFT by
   * construction (opening a composer / staging a file) — never a publish.
   * If a caller somehow needs to model an actual publish, that is out of
   * scope for this class entirely; see docs/EXTERNAL_WRITE_FIREWALL.md.
   */
  async handOffToOwner(currentStage: AssetStage, platform: string, assetId: string): Promise<AssetStage> {
    if (currentStage !== "ready_for_owner") {
      throw new Error(
        `Cannot hand off from stage "${currentStage}" — must be ready_for_owner first.`,
      );
    }
    await authorizeAndAudit(
      {
        name: `${platform}.open_composer_with_draft`,
        actionClass: "EXTERNAL_DRAFT",
        context: { assetId, platform },
      },
      this.auditSink,
    );
    return "handed_off";
  }
}
