import type { SupabaseClient } from "@supabase/supabase-js";
import { hasConcretePartnershipBasis } from "./discoveryScoring.js";
import { SupabasePartnershipRepository } from "./supabasePartnershipRepository.js";
import type { PartnershipProspect } from "./types.js";

const SUPPRESSED_REASON =
  "No evidence this recipient runs or offers an audience, community, business, educational offering, or complementary product -- only topic-relevant text, not a concrete partnership basis. Automatically re-checked; will un-suppress if the evidence is updated.";

/**
 * Reassesses every currently-live, system-qualified recommendation
 * against hasConcretePartnershipBasis (added after the real "pijat jogja"
 * production finding -- a retail customer's review of a prop firm had
 * been auto-qualified purely on a topic keyword match). Reversible and
 * non-destructive:
 *
 * - NEVER touches stage, interactions, or any owner-driven decision --
 *   'archived'/'do_not_contact'/'contacted'/'replied'/'pilot'/
 *   'active_partner'/'closed' prospects are skipped entirely, regardless
 *   of what their evidence looks like now.
 * - NEVER touches a prospect with an approvedCampaignAssetId -- a draft
 *   that already passed the full 9-reviewer pipeline is stronger evidence
 *   than this coarse heuristic can second-guess.
 * - Only reassesses prospects discovery itself could have auto-qualified
 *   (discoveredVia !== 'manual') -- a candidate the owner created and
 *   qualified directly is their own judgment call, not this
 *   reassessment's to second-guess.
 */
export interface ReassessmentResult {
  suppressed: Array<{ id: string; organizationName: string; reason: string }>;
  reactivated: Array<{ id: string; organizationName: string }>;
  skipped: number;
}

function isEligibleForReassessment(prospect: PartnershipProspect): boolean {
  if (prospect.stage !== "qualified" && prospect.stage !== "draft_ready") return false;
  if (prospect.approvedCampaignAssetId) return false;
  // Manually created prospects were never auto-qualified by discovery's
  // own hasConcretePartnershipBasis gate in the first place -- the owner
  // qualified them directly (see qualifyPartnership), so this
  // reassessment (which exists to catch discovery's OWN false positives)
  // has no basis to second-guess that manual judgment call.
  if (prospect.discoveredVia === "manual") return false;
  return true;
}

export async function reassessStoredRecommendations(client: SupabaseClient): Promise<ReassessmentResult> {
  const repo = new SupabasePartnershipRepository(client);
  const prospects = await repo.list();
  const result: ReassessmentResult = { suppressed: [], reactivated: [], skipped: 0 };

  for (const prospect of prospects) {
    if (!isEligibleForReassessment(prospect)) {
      result.skipped += 1;
      continue;
    }
    const basisOk = hasConcretePartnershipBasis({ rawExcerpts: prospect.evidenceExcerpts });
    if (!basisOk && !prospect.suppressedReason) {
      await repo.setSuppressedReason(prospect.id, SUPPRESSED_REASON);
      result.suppressed.push({ id: prospect.id, organizationName: prospect.organizationName, reason: SUPPRESSED_REASON });
    } else if (basisOk && prospect.suppressedReason) {
      await repo.setSuppressedReason(prospect.id, null);
      result.reactivated.push({ id: prospect.id, organizationName: prospect.organizationName });
    }
  }

  return result;
}
