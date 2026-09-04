import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "../src/lib/errorMessage.js";
import { getServiceClient } from "../src/lib/supabaseClient.js";
import { requireAppAuth } from "../src/lib/requireAppAuth.js";
import { buildUtmParams, utmQueryString } from "../src/attribution/utmBuilder.js";
import {
  InboundActionError,
  closeInbound,
  draftResponseForInbound,
  listInbound,
  markFollowUp,
  markResponded,
  runBacklogRecovery,
  summarizeInbound,
} from "../src/inbound/inboundHandlers.js";
import { CampaignFactory, type AssetStage } from "../src/content/campaignFactory.js";
import { ContentQualityGate } from "../src/content/contentQualityGate.js";
import { BrandConstitution } from "../src/knowledge/brandConstitution.js";
import { SupabaseBrandConstitutionRepository } from "../src/knowledge/supabaseRepositories.js";
import {
  ProspectingActionError,
  draftProspectingCandidateReply,
  listProspectingHistory,
  listProspectingQueue,
  markProspectingAlreadyHandled,
  markProspectingNotRelevant,
  markProspectingOpened,
  markProspectingReplied,
  markProspectingSkipped,
  toProspectingJson,
} from "../src/prospecting/prospectingHandlers.js";

/**
 * `?resource=inbound` handles the Inbound Engagement Queue -- a
 * completely different concept (replying to a specific person on X, not
 * approving a drafted post) folded into this file only because Vercel's
 * Hobby plan caps serverless functions at 12 and this project is already
 * at the cap (same reasoning as api/ingest.ts's multi-source
 * consolidation). See docs/INBOUND_ENGAGEMENT.md.
 */
async function handleInbound(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = getServiceClient();

  if (req.method === "GET") {
    try {
      if (req.query.summary === "1") {
        res.status(200).json(await summarizeInbound(client));
        return;
      }
      const includeResolved = req.query.includeResolved === "1";
      res.status(200).json({ items: await listInbound(client, includeResolved) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as { action?: string; id?: string; note?: string } | undefined;
    const action = body?.action;

    if (action === "backlog-recover") {
      res.status(200).json(await runBacklogRecovery(client));
      return;
    }

    if (!body?.id) {
      res.status(400).json({ error: "Body must include { id: string }" });
      return;
    }

    switch (action) {
      case "draft":
        res.status(200).json(await draftResponseForInbound(client, body.id));
        return;
      case "mark-responded":
        await markResponded(client, body.id, body.note);
        res.status(200).json({ id: body.id, status: "responded" });
        return;
      case "follow-up":
        await markFollowUp(client, body.id);
        res.status(200).json({ id: body.id, status: "follow_up" });
        return;
      case "close":
        await closeInbound(client, body.id, body.note);
        res.status(200).json({ id: body.id, status: "closed" });
        return;
      default:
        res.status(400).json({ error: "action must be one of: draft, mark-responded, follow-up, close, backlog-recover" });
    }
  } catch (err) {
    if (err instanceof InboundActionError) {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * `?resource=prospecting` handles the Prospecting queue -- proactive
 * discovery of OTHER people's public X posts, distinct from both
 * `inbound` (people who spoke TO us) and the default approvals resource
 * (drafted campaign posts awaiting a stage decision). Folded in here for
 * the same reason `inbound` is: Vercel Hobby's 12-function cap, already
 * at capacity (confirmed via `ls backend/api/*.ts` before adding this).
 * See docs/PROSPECTING.md.
 */
async function handleProspecting(req: VercelRequest, res: VercelResponse): Promise<void> {
  const client = getServiceClient();

  if (req.method === "GET") {
    try {
      const items = req.query.history === "1" ? await listProspectingHistory(client) : await listProspectingQueue(client);
      res.status(200).json({ items: items.map(toProspectingJson) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body as
      | { action?: string; id?: string; finalReply?: string; mentionsFillbook?: boolean; usedLink?: boolean; reason?: string }
      | undefined;
    const action = body?.action;
    const id = body?.id;
    if (!id) {
      res.status(400).json({ error: "Body must include { id: string }" });
      return;
    }

    switch (action) {
      case "draft":
        res.status(200).json(toProspectingJson(await draftProspectingCandidateReply(client, id)));
        return;
      case "open":
        await markProspectingOpened(client, id);
        res.status(200).json({ id, opened: true });
        return;
      case "mark-replied": {
        const updated = await markProspectingReplied(client, id, body?.finalReply, body?.mentionsFillbook, body?.usedLink);
        res.status(200).json(toProspectingJson(updated));
        return;
      }
      case "skip":
        await markProspectingSkipped(client, id, body?.reason);
        res.status(200).json({ id, status: "skipped" });
        return;
      case "not-relevant":
        await markProspectingNotRelevant(client, id);
        res.status(200).json({ id, status: "not_relevant" });
        return;
      case "already-handled":
        await markProspectingAlreadyHandled(client, id);
        res.status(200).json({ id, status: "already_handled" });
        return;
      default:
        res.status(400).json({ error: "action must be one of: draft, open, mark-replied, skip, not-relevant, already-handled" });
    }
  } catch (err) {
    if (err instanceof ProspectingActionError) {
      res.status(404).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: errorMessage(err) });
  }
}

/**
 * Wires CampaignFactory.handOffToOwner() -- built, tested, and never
 * called from any route until now -- to a real action. EXTERNAL_DRAFT
 * only ("opened the platform's own composer / staged the file for the
 * owner"); there is no code path here or in CampaignFactory that can
 * reach EXTERNAL_WRITE. Requires the asset to actually be at
 * 'ready_for_owner' (handOffToOwner throws otherwise) and persists the
 * resulting 'handed_off' stage -- CampaignFactory itself does no I/O.
 */
async function handOffAsset(client: SupabaseClient, campaignAssetId: string): Promise<{ campaignAssetId: string; stage: string }> {
  const { data: asset, error: assetError } = await client
    .from("campaign_assets")
    .select("stage, platform")
    .eq("id", campaignAssetId)
    .single();
  if (assetError) throw assetError;

  const brandConstitution = new BrandConstitution(new SupabaseBrandConstitutionRepository(client));
  const factory = new CampaignFactory(new ContentQualityGate(brandConstitution));
  const newStage = await factory.handOffToOwner(asset.stage as AssetStage, asset.platform as string, campaignAssetId);

  const { error: updateError } = await client
    .from("campaign_assets")
    .update({ stage: newStage })
    .eq("id", campaignAssetId);
  if (updateError) throw updateError;

  return { campaignAssetId, stage: newStage };
}

/**
 * GET: assembles ApprovalAsset-shaped rows (matching the Android app's
 * data model) from campaign_assets at 'ready_for_owner' whose campaign is
 * still 'in_review' -- i.e. AI-reviewed and genuinely still awaiting a
 * human decision, not already approved or rejected. Flags which ones
 * were produced by the unattended daily auto-draft step
 * (api/daily-pipeline.ts) by checking auto_draft_runs.campaign_id, the
 * same row that already records that run's real cost and timestamp.
 *
 * POST: records the one human decision this whole pipeline exists to
 * wait for. Body: { campaignAssetId, action: "approve" | "reject" }.
 * 'approve' sets campaigns.status = 'approved' -- the only code path
 * anywhere that ever sets this value; auto-draft/run-campaign only ever
 * reach 'in_review'. 'reject' sets campaigns.status = 'retired'. Neither
 * action publishes, posts, or contacts any external platform -- approving
 * here only changes what this app displays; the owner still does the
 * actual posting themselves, same as every other path into
 * CampaignFactory (see docs/EXTERNAL_WRITE_FIREWALL.md).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireAppAuth(req, res)) return;
  if (req.query.resource === "inbound") {
    await handleInbound(req, res);
    return;
  }
  if (req.query.resource === "prospecting") {
    await handleProspecting(req, res);
    return;
  }
  const client = getServiceClient();

  if (req.method === "POST") {
    try {
      const body = req.body as { campaignAssetId?: string; action?: string; decidedBy?: string } | undefined;
      const campaignAssetId = body?.campaignAssetId;
      const action = body?.action;

      if (action === "hand-off") {
        if (!campaignAssetId) {
          res.status(400).json({ error: "Body must include { campaignAssetId: string }" });
          return;
        }
        const result = await handOffAsset(client, campaignAssetId);
        res.status(200).json(result);
        return;
      }

      if (!campaignAssetId || (action !== "approve" && action !== "reject")) {
        res.status(400).json({ error: "Body must be { campaignAssetId: string, action: 'approve' | 'reject' | 'hand-off' }" });
        return;
      }

      const { data: asset, error: assetError } = await client
        .from("campaign_assets")
        .select("campaign_id")
        .eq("id", campaignAssetId)
        .single();
      if (assetError) throw assetError;

      const newStatus = action === "approve" ? "approved" : "retired";
      const now = new Date().toISOString();
      const { error: updateError } = await client
        .from("campaigns")
        .update({
          status: newStatus,
          updated_at: now,
          decided_by: body?.decidedBy?.trim() || null,
          decided_at: now,
        })
        .eq("id", asset.campaign_id);
      if (updateError) throw updateError;

      res.status(200).json({ campaignId: asset.campaign_id, status: newStatus });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { data: assets, error: assetsError } = await client
      .from("campaign_assets")
      .select("id, platform, asset_type, campaign_id, campaigns(thesis, status)")
      .eq("stage", "ready_for_owner");
    if (assetsError) throw assetsError;

    const awaitingDecision = (assets ?? []).filter((asset: any) => asset.campaigns?.status === "in_review");

    const { data: autoDraftRuns, error: autoDraftError } = await client
      .from("auto_draft_runs")
      .select("campaign_id, cost_usd, created_at")
      .eq("status", "drafted");
    if (autoDraftError) throw autoDraftError;
    const autoDraftByCampaignId = new Map(
      ((autoDraftRuns ?? []) as Array<{ campaign_id: string | null; cost_usd: number | null; created_at: string }>)
        .filter((r) => r.campaign_id)
        .map((r) => [r.campaign_id as string, r]),
    );

    const approvals = await Promise.all(
      awaitingDecision.map(async (asset: any) => {
        const { data: latestVersion } = await client
          .from("content_versions")
          .select("id, body")
          .eq("campaign_asset_id", asset.id)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle();

        const autoDraft = autoDraftByCampaignId.get(asset.campaign_id);

        let reviewPassCount = 0;
        let reviewFailCount = 0;
        if (latestVersion) {
          const { data: scores } = await client
            .from("content_scores")
            .select("verdict")
            .eq("content_version_id", latestVersion.id);
          for (const row of (scores ?? []) as Array<{ verdict: string }>) {
            if (row.verdict === "pass") reviewPassCount++;
            else reviewFailCount++;
          }
        }

        const campaignTitle = asset.campaigns?.thesis ?? "(untitled campaign)";
        const utmParams = buildUtmParams(asset.id, asset.platform, campaignTitle);

        return {
          id: asset.id,
          campaignTitle,
          platform: asset.platform,
          assetType: asset.asset_type,
          previewText: latestVersion?.body ?? "",
          stage: "READY_FOR_OWNER",
          isAutoDraft: Boolean(autoDraft),
          costUsd: autoDraft ? Number(autoDraft.cost_usd ?? 0) : null,
          generatedAt: autoDraft ? autoDraft.created_at : null,
          reviewPassCount,
          reviewFailCount,
          // See backend/src/attribution/utmBuilder.ts's kdoc: this is the
          // honest, buildable slice of Attribution -- a consistent tag to
          // append to any fillbookhq.com link in the post, not real
          // click/signup tracking (which needs access this project
          // doesn't have).
          trackingQuery: utmQueryString(utmParams),
        };
      }),
    );

    res.status(200).json({ approvals });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
