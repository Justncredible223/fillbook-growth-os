import type { SupabaseClient } from "@supabase/supabase-js";
import { CampaignFactory } from "../content/campaignFactory.js";
import { ContentQualityGate } from "../content/contentQualityGate.js";
import { BrandConstitution } from "../knowledge/brandConstitution.js";
import { SupabaseBrandConstitutionRepository } from "../knowledge/supabaseRepositories.js";
import { SupabaseContentScoreRepository } from "../content/contentScoreRepository.js";
import { SupabaseCampaignRepository } from "../content/supabaseCampaignRepository.js";
import { createLlmClient, type LlmUsage } from "../content/llmClient.js";
import { runCampaignPipeline, type PipelineOpportunity } from "../content/campaignPipeline.js";
import { estimateCostUsd, recordCostEvent } from "../cost/costTracking.js";
import { evaluatePartnershipBudget, getPartnershipMonthSpendUsd } from "./budget.js";
import { canMarkContacted, isValidTransition } from "./stageTransitions.js";
import { normalizeDomain, normalizeHandle, findExistingMatches, type ExistingMatch } from "./dedup.js";
import { SupabasePartnershipRepository } from "./supabasePartnershipRepository.js";
import type { NewPartnershipProspect, PartnerCategory, PartnershipOutcomeMetric, PartnershipOutcomeSource, PartnershipProspect, PartnershipStage } from "./types.js";

export const PARTNERSHIP_ASSET_TYPE = "partnership_pitch";

export class PartnershipActionError extends Error {}

/** Every prospect creation goes through here so dedup is never skippable by a caller forgetting to check it. Returns the created row plus any cross-system matches found (informational -- creation is never blocked by a match, since a real duplicate might still be a legitimate second contact attempt months later; the owner decides). */
export async function createPartnership(
  client: SupabaseClient,
  input: NewPartnershipProspect,
): Promise<{ prospect: PartnershipProspect; existingMatches: ExistingMatch[] }> {
  const domain = normalizeDomain(input.websiteUrl);
  const handle = normalizeHandle(Object.values(input.socialLinks ?? {})[0]);
  const existingMatches = await findExistingMatches(client, { domain, handle });
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await repo.create(input, { domain, handle });
  return { prospect, existingMatches };
}

export async function listPartnerships(client: SupabaseClient): Promise<PartnershipProspect[]> {
  return new SupabasePartnershipRepository(client).list();
}

export async function updatePartnership(client: SupabaseClient, id: string, patch: Partial<NewPartnershipProspect>): Promise<PartnershipProspect> {
  return new SupabasePartnershipRepository(client).update(id, patch);
}

async function requireProspect(repo: SupabasePartnershipRepository, id: string): Promise<PartnershipProspect> {
  const prospect = await repo.get(id);
  if (!prospect) throw new PartnershipActionError(`No partnership prospect found for id ${id}`);
  return prospect;
}

function requireTransition(from: PartnershipStage, to: PartnershipStage): void {
  if (!isValidTransition(from, to)) {
    throw new PartnershipActionError(`Cannot move a partnership from '${from}' to '${to}'`);
  }
}

export async function qualifyPartnership(client: SupabaseClient, id: string, rationale: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "qualified");
  await repo.update(id, { qualificationRationale: rationale });
  return repo.transitionStage(id, "qualified", { interactionType: "note", summary: `Qualified: ${rationale}` });
}

export interface GenerateDraftResult {
  status: "ready" | "failed" | "skipped";
  campaignAssetId?: string;
  skipReason?: string;
  error?: string;
  costUsd: number;
  aiCalls: number;
  /** How many full draft+review attempts actually ran (1 or 2 -- see MAX_DRAFT_ATTEMPTS). */
  attempts: number;
}

/** One initial attempt plus one bounded revision using the first attempt's own review-gate feedback -- never more, so a stubborn rejection can't loop indefinitely burning budget. Both attempts count against the same per-call cost/budget accounting. */
const MAX_DRAFT_ATTEMPTS = 2;

/**
 * Generates and reviews a pitch draft for a qualified prospect, reusing
 * the SAME pipeline every other content type goes through (mechanical
 * gate + all 9 deep-review agents) -- never a lighter or skipped review
 * just because this is a business pitch rather than a public post. Gated
 * by Partnerships' own independent monthly budget (see budget.ts), fully
 * separate from auto-draft/prospecting/x-feed-post's spend. On success,
 * the new campaign_asset becomes the prospect's `approvedCampaignAssetId`
 * -- calling this again for the same prospect (e.g. after a rejected
 * draft, or because the owner wants a different angle) REPLACES it with
 * the new one, which is exactly how "material edits invalidate any prior
 * approval" is enforced here: there is only ever one current approved
 * draft per prospect, and generating a new one is the only way its text
 * changes.
 *
 * If the first attempt fails the mechanical or review gate, ONE bounded
 * revision is attempted automatically, feeding the writer the exact
 * block reasons from the first attempt (see contentWriter.ts's
 * pitchContext.priorFeedback) -- never a second blind guess. Both
 * attempts share this one call's budget check; the loop stops early if
 * the budget runs out between attempts. Neither attempt ever lowers the
 * mechanical gate or skips a reviewer -- a revision must pass the exact
 * same bar as a first attempt.
 */
export async function generateDraftForPartnership(client: SupabaseClient, id: string): Promise<GenerateDraftResult> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  if (prospect.stage !== "qualified" && prospect.stage !== "draft_ready") {
    throw new PartnershipActionError(`A partnership must be 'qualified' before a draft can be generated (currently '${prospect.stage}')`);
  }
  if (!prospect.proposedCollaboration) {
    throw new PartnershipActionError("proposedCollaboration must be set before generating a draft -- the pipeline needs a concrete offer to write about, not a blank ask.");
  }

  const monthSpend = await getPartnershipMonthSpendUsd(client);
  const budgetCheck = evaluatePartnershipBudget(monthSpend);
  if (!budgetCheck.eligible) {
    return { status: "skipped", skipReason: budgetCheck.reason, costUsd: 0, aiCalls: 0, attempts: 0 };
  }

  const brandConstitution = new BrandConstitution(new SupabaseBrandConstitutionRepository(client));
  const activeRules = await brandConstitution.getActiveRules();
  const brandRulesSummary = activeRules.map((r) => `[${r.ruleType}] ${r.content}`).join("\n");
  const { data: knowledgeRows } = await client.from("knowledge_documents").select("title, content").eq("trust_level", "verified");
  const verifiedKnowledgeSummary = ((knowledgeRows ?? []) as Array<{ title: string; content: string }>)
    .map((row) => `${row.title}: ${row.content}`)
    .join("\n");

  // Per-recipient dedup: never compare a new pitch against OTHER
  // recipients' pitches (irrelevant), only this same prospect's own prior
  // draft, if one already exists.
  const recentTextsForSameTopic: string[] = [];
  if (prospect.approvedCampaignAssetId) {
    const { data: versions } = await client.from("content_versions").select("body").eq("campaign_asset_id", prospect.approvedCampaignAssetId);
    for (const v of (versions ?? []) as Array<{ body: string }>) recentTextsForSameTopic.push(v.body);
  }

  const usages: LlmUsage[] = [];
  const llmClient = createLlmClient(process.env, (usage) => {
    usages.push(usage);
    void recordCostEvent(client, usage, { endpoint: "partnerships", partnershipId: id }, "partnership_llm_call");
  });

  const { data: opportunityRow, error: opportunityError } = await client
    .from("opportunities")
    .insert({
      title: `Partnership pitch: ${prospect.organizationName}`,
      score: 0,
      urgency: "normal",
      confidence: 1,
      rationale: prospect.proposedCollaboration,
      recommended_channels: [prospect.contactRoute?.toLowerCase().includes("x") ? "x" : "email"],
      recommended_campaign_type: "partnership_pitch",
      approval_class: "EXTERNAL_DRAFT",
      signal_ids: [],
    })
    .select("id")
    .single();
  if (opportunityError) throw new Error(`createOpportunityForPartnership failed: ${opportunityError.message}`);
  await client.from("opportunities").update({ status: "actioned", updated_at: new Date().toISOString() }).eq("id", opportunityRow.id);

  const pitchChannel: "email" | "x" = prospect.contactRoute?.toLowerCase().includes("x") ? "x" : "email";

  const opportunity: PipelineOpportunity = {
    id: opportunityRow.id,
    title: `Partnership pitch to ${prospect.organizationName}`,
    rationale: prospect.proposedCollaboration,
    recommendedChannels: [pitchChannel],
  };

  const factory = new CampaignFactory(new ContentQualityGate(brandConstitution));

  let attempts = 0;
  let priorFeedback: string | undefined;
  let lastResult: Awaited<ReturnType<typeof runCampaignPipeline>> | null = null;

  while (attempts < MAX_DRAFT_ATTEMPTS) {
    if (attempts > 0) {
      // Re-check budget before a revision attempt -- the first attempt's
      // own cost may have already used up what was left.
      const spendSoFar = await getPartnershipMonthSpendUsd(client);
      if (!evaluatePartnershipBudget(spendSoFar).eligible) break;
    }
    attempts += 1;
    lastResult = await runCampaignPipeline(
      llmClient,
      factory,
      new SupabaseContentScoreRepository(client),
      new SupabaseCampaignRepository(client),
      opportunity,
      {
        brandRulesSummary,
        verifiedKnowledgeSummary,
        recentTextsForSameTopic,
        assetTypeOverride: PARTNERSHIP_ASSET_TYPE,
        contentFormat: "partnership_pitch",
        pitchRecipientOrganization: prospect.organizationName,
        pitchChannel,
        pitchEvidenceExcerpts: prospect.evidenceExcerpts,
        pitchPriorFeedback: priorFeedback,
      },
    );
    if (lastResult.finalStage === "ready_for_owner") break;
    priorFeedback =
      lastResult.mechanicalBlockReasons.length > 0
        ? `quality gate: ${lastResult.mechanicalBlockReasons.join("; ")}`
        : `review gate: ${lastResult.deepReview?.blockReasons.join("; ") ?? "unknown"}`;
  }

  const result = lastResult!;
  const costUsd = usages.reduce((sum, u) => sum + estimateCostUsd(u), 0);

  if (result.finalStage === "ready_for_owner") {
    await repo.setApprovedDraft(id, result.campaignAssetId);
    await repo.insertInteraction(id, "draft_generated", `Draft generated and passed review after ${attempts} attempt${attempts === 1 ? "" : "s"} (campaign_asset ${result.campaignAssetId}).`);
    if (prospect.stage === "qualified") {
      await repo.transitionStage(id, "draft_ready", { interactionType: "note", summary: "Moved to draft_ready after a passing draft." });
    }
    return { status: "ready", campaignAssetId: result.campaignAssetId, costUsd, aiCalls: usages.length, attempts };
  }

  const error = `(after ${attempts} attempt${attempts === 1 ? "" : "s"}) ${priorFeedback ?? "unknown"}`;
  await repo.insertInteraction(id, "draft_generated", `Draft attempt failed: ${error}`);
  return { status: "failed", error, costUsd, aiCalls: usages.length, attempts };
}

/**
 * The owner's own explicit confirmation that they actually contacted this
 * prospect -- never inferred from a draft merely existing or being
 * copied. Requires a currently-approved, passing draft (canMarkContacted)
 * so a prospect can never be marked contacted with no real reviewed
 * message behind it. `finalText` is the ACTUAL text sent (may differ from
 * the draft after an owner edit) -- stored in the interaction log so
 * there's a real record of what was actually said, same reasoning as
 * Today's X Post's posted_text.
 */
export async function markPartnershipContacted(
  client: SupabaseClient,
  id: string,
  channel: string,
  finalText: string,
): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  if (!canMarkContacted(prospect.stage, prospect.approvedCampaignAssetId)) {
    throw new PartnershipActionError(
      `Cannot mark contacted: prospect must be 'draft_ready' with an approved draft (currently '${prospect.stage}', approvedCampaignAssetId=${prospect.approvedCampaignAssetId ?? "null"})`,
    );
  }
  const now = new Date().toISOString();
  await repo.recordContact(id, channel, now);
  return repo.transitionStage(id, "contacted", { interactionType: "contacted", summary: `Contacted via ${channel}: ${finalText}` });
}

export async function recordPartnershipReply(client: SupabaseClient, id: string, summary: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "replied");
  return repo.transitionStage(id, "replied", { interactionType: "reply_received", summary });
}

export async function startPartnershipPilot(client: SupabaseClient, id: string, termsAgreed: string, startDate: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "pilot");
  const { error } = await client.from("partnership_prospects").update({ pilot_terms_agreed: termsAgreed, pilot_start_date: startDate, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`startPartnershipPilot failed: ${error.message}`);
  return repo.transitionStage(id, "pilot", { interactionType: "pilot_started", summary: `Pilot started ${startDate}: ${termsAgreed}` });
}

export async function activatePartnership(client: SupabaseClient, id: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "active_partner");
  return repo.transitionStage(id, "active_partner", { interactionType: "note", summary: "Became an active partner." });
}

export async function closePartnership(client: SupabaseClient, id: string, reason: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "closed");
  return repo.transitionStage(id, "closed", { interactionType: "note", summary: `Closed: ${reason}` });
}

export async function archivePartnership(client: SupabaseClient, id: string, reason: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "archived");
  return repo.transitionStage(id, "archived", { interactionType: "note", summary: `Archived: ${reason}` });
}

export async function markPartnershipDoNotContact(client: SupabaseClient, id: string, reason: string): Promise<PartnershipProspect> {
  const repo = new SupabasePartnershipRepository(client);
  const prospect = await requireProspect(repo, id);
  requireTransition(prospect.stage, "do_not_contact");
  return repo.transitionStage(id, "do_not_contact", { interactionType: "note", summary: `Do not contact: ${reason}` });
}

export async function recordPartnershipOutcome(
  client: SupabaseClient,
  id: string,
  metric: PartnershipOutcomeMetric,
  value: number | null,
  source: PartnershipOutcomeSource,
  note?: string | null,
): Promise<void> {
  const repo = new SupabasePartnershipRepository(client);
  await requireProspect(repo, id); // 404s cleanly rather than inserting an outcome for a nonexistent prospect
  await repo.recordOutcome(id, metric, value, source, note);
  await repo.insertInteraction(id, "outcome_recorded", `${metric}: ${source === "measured" ? value : `${value} (manually entered)`}${note ? ` -- ${note}` : ""}`);
}

export function toPartnershipJson(prospect: PartnershipProspect) {
  return prospect;
}

export type { PartnerCategory };
