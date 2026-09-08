import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchReport } from "../content/researchWriter.js";

export type ResearchRecordStatus = "ready_for_review" | "approved" | "rejected" | "failed";

export interface ResearchRecordJson {
  id: string;
  title: string;
  question: string;
  summary: string;
  findings: string[];
  evidenceReferences: string[];
  caveats: string[];
  contentAngles: string[];
  status: ResearchRecordStatus;
  costUsd: number | null;
  createdAt: string;
}

interface CampaignAssetRow {
  id: string;
  stage: string;
  created_at: string;
  campaigns: { status: string } | { status: string }[] | null;
}

/** Pure, exported, and independent of Supabase -- given a campaign's status and its research asset's own stage, returns the one ResearchRecordStatus the Android app should show. "requested"/"researching" are transient client-side states only (the moment between the app's own POST and this GET reflecting a persisted row) and are never returned here. */
export function resolveResearchRecordStatus(campaignStatus: string, assetStage: string): ResearchRecordStatus {
  if (campaignStatus === "approved") return "approved";
  if (campaignStatus === "retired") return "rejected";
  if (campaignStatus === "in_review" && assetStage === "ready_for_owner") return "ready_for_review";
  // Anything else (campaign still 'draft') means the mechanical gate
  // rejected the draft and the research pipeline never advanced past it --
  // there is no retry path for this exact record, so it's terminal, same
  // as an explicit rejection.
  return "failed";
}

/** Pure parsing, independent of Supabase -- tolerant of a missing/malformed metadata.research shape (returns null rather than throwing), same tolerance videoStatusHandlers.ts's parseVideoRenderMetadata applies to metadata.videoScript. */
export function parseResearchReport(rawMetadata: unknown): ResearchReport | null {
  if (typeof rawMetadata !== "object" || rawMetadata === null) return null;
  const research = (rawMetadata as Record<string, unknown>).research;
  if (typeof research !== "object" || research === null) return null;
  const r = research as Record<string, unknown>;
  if (
    typeof r.title !== "string" ||
    typeof r.question !== "string" ||
    typeof r.summary !== "string" ||
    !Array.isArray(r.findings) ||
    !Array.isArray(r.evidenceReferences) ||
    !Array.isArray(r.caveats) ||
    !Array.isArray(r.contentAngles)
  ) {
    return null;
  }
  return {
    title: r.title,
    question: r.question,
    summary: r.summary,
    findings: r.findings as string[],
    evidenceReferences: r.evidenceReferences as string[],
    caveats: r.caveats as string[],
    contentAngles: r.contentAngles as string[],
  };
}

function readCostUsd(rawMetadata: unknown): number | null {
  if (typeof rawMetadata !== "object" || rawMetadata === null) return null;
  const cost = (rawMetadata as Record<string, unknown>).costUsd;
  return typeof cost === "number" ? cost : null;
}

/** Lists every research record (campaign_assets.asset_type = 'research'), joined to its parent campaign's status and its own latest content_versions row -- the Approvals "?resource=research" GET branch's data source, and the Android Research Lab list screen's ultimate origin. */
export async function listResearchRecords(client: SupabaseClient, limit = 100): Promise<ResearchRecordJson[]> {
  const { data: assets, error: assetsError } = await client
    .from("campaign_assets")
    .select("id, stage, created_at, campaigns(status)")
    .eq("asset_type", "research")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (assetsError) throw new Error(`listResearchRecords failed: ${assetsError.message}`);

  const rows = (assets ?? []) as CampaignAssetRow[];
  if (rows.length === 0) return [];

  const { data: versions } = await client
    .from("content_versions")
    .select("campaign_asset_id, metadata, version, created_at")
    .in("campaign_asset_id", rows.map((r) => r.id))
    .order("version", { ascending: false });

  const latestByAssetId = new Map<string, { metadata: unknown }>();
  for (const v of (versions ?? []) as Array<{ campaign_asset_id: string; metadata: unknown }>) {
    // Rows arrive ordered by version desc -- the first one seen per asset
    // id is its latest version, same pattern as videoStatusHandlers.ts.
    if (latestByAssetId.has(v.campaign_asset_id)) continue;
    latestByAssetId.set(v.campaign_asset_id, { metadata: v.metadata });
  }

  const records: ResearchRecordJson[] = [];
  for (const row of rows) {
    const campaignStatus = Array.isArray(row.campaigns) ? row.campaigns[0]?.status : row.campaigns?.status;
    const version = latestByAssetId.get(row.id);
    const report = version ? parseResearchReport(version.metadata) : null;
    if (!report) continue; // no readable research content yet -- nothing useful to show.

    records.push({
      id: row.id,
      title: report.title,
      question: report.question,
      summary: report.summary,
      findings: report.findings,
      evidenceReferences: report.evidenceReferences,
      caveats: report.caveats,
      contentAngles: report.contentAngles,
      status: resolveResearchRecordStatus(campaignStatus ?? "draft", row.stage),
      costUsd: version ? readCostUsd(version.metadata) : null,
      createdAt: row.created_at,
    });
  }
  return records;
}

/**
 * Best-effort: records a research run's real LLM cost onto its own latest
 * content_versions row, merged into that row's existing `metadata` JSON
 * (Supabase JS can't merge JSONB in one call -- this is a read-then-write,
 * same as every other best-effort metadata patch in this codebase, e.g.
 * videoStatusHandlers.ts's signed-URL minting). Never throws -- a failure
 * here must never fail or roll back the research run itself, only cost
 * visibility for it.
 */
export async function recordResearchCost(client: SupabaseClient, campaignAssetId: string, costUsd: number): Promise<void> {
  try {
    const { data: version, error: selectError } = await client
      .from("content_versions")
      .select("id, metadata")
      .eq("campaign_asset_id", campaignAssetId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (selectError || !version) return;

    const existingMetadata = (version.metadata && typeof version.metadata === "object" ? version.metadata : {}) as Record<
      string,
      unknown
    >;
    const { error: updateError } = await client
      .from("content_versions")
      .update({ metadata: { ...existingMetadata, costUsd } })
      .eq("id", version.id);
    if (updateError) {
      // eslint-disable-next-line no-console
      console.error(`recordResearchCost: failed to update content_versions ${version.id}: ${updateError.message}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`recordResearchCost: unexpected failure for campaignAssetId ${campaignAssetId}:`, err);
  }
}
