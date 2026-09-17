import { scoreOpportunity } from "./scoring.js";
import type { ApprovalClass, Opportunity, OpportunityRepository, ScoringInput } from "./types.js";

// Below this score, scoreOpportunity() already tags an opportunity
// 'low' urgency -- i.e. its own evidence says it's a marginal signal.
// Previously every candidate was inserted regardless, so weak,
// low-confidence signals (e.g. a single loosely-matched keyword hit)
// piled up as open opportunities forever with nothing to ever clear
// them out. Skipping insertion here, combined with expireStale() for
// anything that does qualify but goes unactioned, is what keeps the
// open list to opportunities actually worth the owner's attention.
const MIN_SCORE_TO_CREATE = 30;

export class OpportunityEngine {
  constructor(private repo: OpportunityRepository) {}

  async createFromEvidence(input: ScoringInput): Promise<Opportunity | null> {
    const { score, urgency, rationale } = scoreOpportunity(input);

    if (score < MIN_SCORE_TO_CREATE) return null;

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
