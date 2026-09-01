import { authorizeAndAudit, type AuditSink } from "../firewall/externalWriteFirewall";
import { ContentQualityGate } from "./contentQualityGate";

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
