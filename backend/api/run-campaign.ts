import type { VercelRequest, VercelResponse } from "@vercel/node";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { SupabaseOpportunityRepository } from "../src/opportunities/supabaseOpportunityRepository.js";
import type { OpportunityRepository } from "../src/opportunities/types.js";
import { runCampaignForOpportunity, buildSupabaseRunCampaignDeps } from "../src/content/runCampaignForOpportunity.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";
import { isPlausiblyTradingRelated } from "../src/prospecting/prospectingRelevance.js";
import { validateVideoTopicShape, manualVideoTopicTitle, manualVideoTopicOpportunityInput } from "../src/opportunities/manualVideoTopic.js";
import { validateResearchTopicShape, manualResearchTopicTitle, manualResearchTopicOpportunityInput } from "../src/opportunities/manualResearchTopic.js";
import { recordResearchCost } from "../src/research/researchHandlers.js";

/** The only asset-type overrides this endpoint will ever accept from a caller -- see the `assetType` handling below for why this is validated as an exact-match allowlist, never passed through freely. */
export const ALLOWED_ASSET_TYPE_OVERRIDES = ["video_script", "research"] as const;
export type AllowedAssetTypeOverride = (typeof ALLOWED_ASSET_TYPE_OVERRIDES)[number];

/** Pure, exported, and unit-testable independent of Supabase/Vercel -- same shape as ingest.ts's own isManualIngestSource, this codebase's established pattern for validating a caller-supplied enum-like field before it's ever trusted downstream. */
export function isAllowedAssetTypeOverride(value: unknown): value is AllowedAssetTypeOverride {
  return typeof value === "string" && (ALLOWED_ASSET_TYPE_OVERRIDES as readonly string[]).includes(value);
}

/**
 * Manual trigger: runs one opportunity through the full Opportunity ->
 * draft -> mechanical gate -> nine-agent deep review -> ready_for_owner
 * pipeline. Never publishes anything -- the furthest an asset can reach
 * here is 'ready_for_owner'. Costs real LLM tokens (one drafting call
 * plus up to nine review calls), so POST-only. See
 * src/content/runCampaignForOpportunity.ts for the shared, testable
 * implementation also used by the scheduled auto-draft step
 * (api/daily-pipeline.ts) -- this endpoint tags its cost events
 * source: "manual" to distinguish itself from that automated path.
 *
 * Optional `assetType` field (2026-09-08): lets the owner explicitly
 * request a video_script for ANY open opportunity, not just one whose
 * recommended channel happens to be a video platform -- added because the
 * TikTok/YouTube signal adapters that used to produce video-first
 * opportunities were intentionally removed (see api/ingest.ts's own doc
 * comment), which otherwise left the video-script pipeline permanently
 * unreachable even though it's fully implemented and tested. Gated behind
 * requireAppAuth like every other field on this same authenticated
 * endpoint -- there is no separate, less-trusted path for it. The value
 * is checked against an exact allowlist (ALLOWED_ASSET_TYPE_OVERRIDES)
 * before it's ever passed downstream, so a caller can request the one
 * legitimate override this feature exists for and nothing else -- an
 * arbitrary string here is rejected with 400, never silently accepted or
 * coerced. Reuses every existing safeguard unchanged: the same paused
 * check below, the same nine-agent review/budget/grounding pipeline, and
 * the same listOpen()-based idempotency (a second request for an
 * opportunity that already reached ready_for_owner 404s here exactly like
 * a duplicate text campaign request already does, since
 * markOpportunityActioned moves it out of 'open' status).
 *
 * Optional `topic` field (2026-09-08, "Create Fillbook Video"): lets the
 * owner type a brand-new video topic directly, instead of picking from
 * whatever happens to already be an open opportunity. Only valid together
 * with `assetType: "video_script"` (never with `opportunityId` -- exactly
 * one of the two selects what gets drafted). Before anything paid ever
 * happens:
 * 1. Shape-validated (length bounds) via validateVideoTopicShape.
 * 2. Topic-relevance validated via the SAME zero-cost, $0, pre-LLM gate
 *    Prospecting already uses (isPlausiblyTradingRelated) -- an unrelated
 *    topic is rejected with 400 before any LLM call, exactly like an
 *    off-topic Prospecting candidate is filtered before it ever becomes
 *    actionable. Applied to an existing-opportunity request too (when
 *    assetType is "video_script"), not just the free-typed-topic path --
 *    requirement 4 is "reject unrelated topics", not "reject unrelated
 *    typed topics specifically."
 * 3. Checked for an existing opportunity with the identical (whitespace/
 *    case-insensitive) canonical title -- see manualVideoTopicTitle --
 *    and rejected with 409 if one already exists, regardless of that
 *    opportunity's current status. This is the duplicate-prevention gate
 *    for "the same topic requested twice" (a rapid double-tap is caught
 *    first, and more cheaply, by the Android app's own busy-state guard
 *    on the button itself).
 * Only once all three pass does this create a real (if minimal)
 * `opportunities` row for the topic and hand it to the exact same
 * runCampaignForOpportunity call every other request already goes
 * through -- no separate pipeline, no separate budget/idempotency logic.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const client = getServiceClient();

    const { data: settings } = await client.from("system_settings").select("paused").eq("id", true).single();
    if (settings?.paused) {
      res.status(409).json({ error: "System is paused -- unpause it in Settings before running a campaign manually." });
      return;
    }

    const body = req.body as { opportunityId?: string; topic?: unknown; assetType?: unknown } | undefined;
    const opportunityId = body?.opportunityId;
    const rawTopic = body?.topic;

    let assetTypeOverride: AllowedAssetTypeOverride | undefined;
    if (body?.assetType !== undefined) {
      if (!isAllowedAssetTypeOverride(body.assetType)) {
        res.status(400).json({ error: `assetType, if provided, must be one of: ${ALLOWED_ASSET_TYPE_OVERRIDES.join(", ")}` });
        return;
      }
      assetTypeOverride = body.assetType;
    }

    if (rawTopic !== undefined && opportunityId) {
      res.status(400).json({ error: "Provide either topic or opportunityId, not both." });
      return;
    }
    if (rawTopic !== undefined && assetTypeOverride !== "video_script" && assetTypeOverride !== "research") {
      res.status(400).json({ error: "topic is only valid together with assetType: 'video_script' or 'research'." });
      return;
    }

    // Typed as the interface, not the concrete class -- OpportunityRepository.insert
    // correctly omits createdAt (assigned by the DB default), matching how
    // OpportunityEngine.createFromEvidence already calls it elsewhere.
    const opportunityRepo: OpportunityRepository = new SupabaseOpportunityRepository(client);
    let opportunity: Awaited<ReturnType<typeof opportunityRepo.listOpen>>[number] | undefined;

    if (rawTopic !== undefined) {
      const isResearchRequest = assetTypeOverride === "research";
      const shapeError = isResearchRequest ? validateResearchTopicShape(rawTopic) : validateVideoTopicShape(rawTopic);
      if (shapeError) {
        res.status(400).json({ error: shapeError.reason });
        return;
      }
      const topic = rawTopic as string;
      if (!isPlausiblyTradingRelated(topic)) {
        res.status(400).json({
          error:
            "This topic doesn't read as futures trading, prop-firm trading, or trading discipline -- rephrase it to be " +
            "more specific, or pick an existing Radar opportunity instead.",
        });
        return;
      }

      const canonicalTitle = isResearchRequest ? manualResearchTopicTitle(topic) : manualVideoTopicTitle(topic);
      const { data: existingDup, error: dupError } = await client
        .from("opportunities")
        .select("id, status")
        .ilike("title", canonicalTitle)
        .limit(1);
      if (dupError) throw new Error(`Duplicate-topic check failed: ${dupError.message}`);
      if (existingDup && existingDup.length > 0) {
        const kind = isResearchRequest ? "research report" : "video";
        res.status(409).json({
          error: `A ${kind} for this topic already exists (opportunity ${existingDup[0]!.id}, status: ${existingDup[0]!.status}) -- check Approvals or Radar before requesting it again.`,
        });
        return;
      }

      opportunity = await opportunityRepo.insert(
        isResearchRequest ? manualResearchTopicOpportunityInput(topic) : manualVideoTopicOpportunityInput(topic),
      );
    } else {
      const openOpportunities = await opportunityRepo.listOpen();
      opportunity = opportunityId
        ? openOpportunities.find((o) => o.id === opportunityId)
        : openOpportunities[0];

      if (
        opportunity &&
        (assetTypeOverride === "video_script" || assetTypeOverride === "research") &&
        !isPlausiblyTradingRelated(`${opportunity.title} ${opportunity.rationale}`)
      ) {
        res.status(400).json({
          error:
            assetTypeOverride === "research"
              ? "This opportunity doesn't read as futures/trading-related enough for research -- pick a different one, or use a custom topic instead."
              : "This opportunity doesn't read as futures/trading-related enough for a video -- pick a different one, or use a custom topic instead.",
        });
        return;
      }

      // Duplicate-opportunity prevention for research (2026-09-07): unlike
      // a freshly-typed topic (caught above by the canonical-title check),
      // an EXISTING opportunity can already have a non-retired research
      // record from a prior request -- listOpen() alone doesn't catch this
      // because the opportunity itself is still 'open' (research doesn't
      // touch opportunities.status the way a completed pipeline run does
      // via markOpportunityActioned; it only does that once IT reaches
      // ready_for_owner, and a second concurrent request could otherwise
      // race in before that happens). Requesting a video for an
      // opportunity that already has research (or vice versa) is fine --
      // this only blocks a second research request for the SAME
      // opportunity.
      if (opportunity && assetTypeOverride === "research") {
        const { data: existingAssets, error: existingAssetsError } = await client
          .from("campaign_assets")
          .select("id, campaign_id, campaigns!inner(opportunity_id, status)")
          .eq("asset_type", "research")
          .eq("campaigns.opportunity_id", opportunity.id)
          .neq("campaigns.status", "retired")
          .limit(1);
        if (existingAssetsError) throw new Error(`Duplicate-opportunity research check failed: ${existingAssetsError.message}`);
        if (existingAssets && existingAssets.length > 0) {
          res.status(409).json({
            error: `Research already exists for this opportunity (campaign asset ${existingAssets[0]!.id}) -- check Approvals before requesting it again.`,
          });
          return;
        }
      }
    }

    if (!opportunity) {
      res.status(404).json({ error: opportunityId ? `No open opportunity with id ${opportunityId}` : "No open opportunities to run" });
      return;
    }

    const { deps, usage } = await buildSupabaseRunCampaignDeps(client, () => opportunity!.id, "manual");
    const result = await runCampaignForOpportunity(deps, opportunity, { assetTypeOverride });

    if (assetTypeOverride === "research") {
      // Best-effort -- never blocks or fails the main response (see
      // recordResearchCost's own doc comment for why this is a swallowed,
      // logged-only failure path).
      void recordResearchCost(client, result.campaignAssetId, usage.costUsd());
    }

    res.status(200).json({ result, aiCalls: usage.aiCalls(), costUsd: usage.costUsd() });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
