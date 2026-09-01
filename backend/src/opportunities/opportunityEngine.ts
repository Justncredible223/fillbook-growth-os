import { scoreOpportunity } from "./scoring";
import type { ApprovalClass, Opportunity, OpportunityRepository, ScoringInput } from "./types";

export class OpportunityEngine {
  constructor(private repo: OpportunityRepository) {}

  async createFromEvidence(input: ScoringInput): Promise<Opportunity> {
    const { score, urgency, rationale } = scoreOpportunity(input);

    // EXTERNAL_WRITE is never a valid approval class for an opportunity —
    // an opportunity is a recommendation, never itself a publish action.
    const approvalClass: ApprovalClass = "EXTERNAL_DRAFT";

    return this.repo.insert({
      title: input.title,
      score,
      urgency,
      confidence: input.confidence,
      rationale,
      recommendedChannels: input.recommendedChannels,
      recommendedCampaignType: input.recommendedCampaignType ?? null,
      approvalClass,
      signalIds: input.signalIds,
    });
  }
}
