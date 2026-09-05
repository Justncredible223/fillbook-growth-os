import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  NewPartnershipProspect,
  PartnershipInteraction,
  PartnershipInteractionType,
  PartnershipOutcomeMetric,
  PartnershipOutcomeSource,
  PartnershipProspect,
  PartnershipRepository,
  PartnershipStage,
} from "./types.js";

function fromRow(row: Record<string, any>): PartnershipProspect {
  return {
    id: row.id,
    organizationName: row.organization_name,
    contactName: row.contact_name,
    partnerCategory: row.partner_category,
    stage: row.stage,
    websiteUrl: row.website_url,
    socialLinks: row.social_links ?? {},
    contactRoute: row.contact_route,
    contactRouteSource: row.contact_route_source,
    audienceFocus: row.audience_focus,
    futuresRelevanceEvidence: row.futures_relevance_evidence,
    sourceUrls: row.source_urls ?? [],
    evidenceExcerpts: row.evidence_excerpts ?? [],
    researchDate: row.research_date,
    competingJournalRelationships: row.competing_journal_relationships,
    competingJournalEvidence: row.competing_journal_evidence,
    proposedCollaboration: row.proposed_collaboration,
    qualificationRationale: row.qualification_rationale,
    ownerNotes: row.owner_notes,
    nextAction: row.next_action,
    nextActionDueDate: row.next_action_due_date,
    pilotTermsProposed: row.pilot_terms_proposed,
    pilotTermsAgreed: row.pilot_terms_agreed,
    pilotStartDate: row.pilot_start_date,
    pilotEndDate: row.pilot_end_date,
    referralCode: row.referral_code,
    followUpCount: row.follow_up_count,
    approvedCampaignAssetId: row.approved_campaign_asset_id,
    contactedAt: row.contacted_at,
    contactedChannel: row.contacted_channel,
    normalizedDomain: row.normalized_domain,
    normalizedHandle: row.normalized_handle,
    discoveryScore: row.discovery_score === null || row.discovery_score === undefined ? null : Number(row.discovery_score),
    discoveryConfidence: row.discovery_confidence ?? null,
    discoveredVia: row.discovered_via ?? "manual",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function interactionFromRow(row: Record<string, any>): PartnershipInteraction {
  return {
    id: row.id,
    partnershipId: row.partnership_id,
    interactionType: row.interaction_type,
    occurredAt: row.occurred_at,
    summary: row.summary,
  };
}

/** Converts the camelCase patch fields this module works with into the snake_case columns the table actually has -- shared by create() and update() so the two never drift apart on field naming. */
function toRow(input: Partial<NewPartnershipProspect>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.organizationName !== undefined) row.organization_name = input.organizationName;
  if (input.contactName !== undefined) row.contact_name = input.contactName;
  if (input.partnerCategory !== undefined) row.partner_category = input.partnerCategory;
  if (input.websiteUrl !== undefined) row.website_url = input.websiteUrl;
  if (input.socialLinks !== undefined) row.social_links = input.socialLinks;
  if (input.contactRoute !== undefined) row.contact_route = input.contactRoute;
  if (input.contactRouteSource !== undefined) row.contact_route_source = input.contactRouteSource;
  if (input.audienceFocus !== undefined) row.audience_focus = input.audienceFocus;
  if (input.futuresRelevanceEvidence !== undefined) row.futures_relevance_evidence = input.futuresRelevanceEvidence;
  if (input.sourceUrls !== undefined) row.source_urls = input.sourceUrls;
  if (input.evidenceExcerpts !== undefined) row.evidence_excerpts = input.evidenceExcerpts;
  if (input.researchDate !== undefined) row.research_date = input.researchDate;
  if (input.competingJournalRelationships !== undefined) row.competing_journal_relationships = input.competingJournalRelationships;
  if (input.competingJournalEvidence !== undefined) row.competing_journal_evidence = input.competingJournalEvidence;
  if (input.proposedCollaboration !== undefined) row.proposed_collaboration = input.proposedCollaboration;
  if (input.qualificationRationale !== undefined) row.qualification_rationale = input.qualificationRationale;
  if (input.ownerNotes !== undefined) row.owner_notes = input.ownerNotes;
  if (input.discoveryScore !== undefined) row.discovery_score = input.discoveryScore;
  if (input.discoveryConfidence !== undefined) row.discovery_confidence = input.discoveryConfidence;
  if (input.discoveredVia !== undefined) row.discovered_via = input.discoveredVia;
  return row;
}

export class SupabasePartnershipRepository implements PartnershipRepository {
  constructor(private client: SupabaseClient) {}

  async list(): Promise<PartnershipProspect[]> {
    const { data, error } = await this.client.from("partnership_prospects").select().order("updated_at", { ascending: false });
    if (error) throw new Error(`list partnerships failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }

  async get(id: string): Promise<PartnershipProspect | null> {
    const { data, error } = await this.client.from("partnership_prospects").select().eq("id", id).maybeSingle();
    if (error) throw new Error(`get partnership failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async create(input: NewPartnershipProspect, normalized: { domain: string | null; handle: string | null }): Promise<PartnershipProspect> {
    const { data, error } = await this.client
      .from("partnership_prospects")
      .insert({
        discovered_via: "manual",
        ...toRow(input),
        stage: "prospect",
        follow_up_count: 0,
        approved_campaign_asset_id: null,
        contacted_at: null,
        contacted_channel: null,
        normalized_domain: normalized.domain,
        normalized_handle: normalized.handle,
      })
      .select()
      .single();
    if (error) throw new Error(`create partnership failed: ${error.message}`);
    return fromRow(data);
  }

  async update(id: string, patch: Partial<NewPartnershipProspect>): Promise<PartnershipProspect> {
    const { data, error } = await this.client
      .from("partnership_prospects")
      .update({ ...toRow(patch), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`update partnership failed: ${error.message}`);
    return fromRow(data);
  }

  async transitionStage(
    id: string,
    toStage: PartnershipStage,
    interaction: { interactionType: PartnershipInteractionType; summary: string },
  ): Promise<PartnershipProspect> {
    const { data, error } = await this.client
      .from("partnership_prospects")
      .update({ stage: toStage, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`transitionStage failed: ${error.message}`);
    await this.insertInteraction(id, interaction.interactionType, interaction.summary);
    return fromRow(data);
  }

  async setApprovedDraft(id: string, campaignAssetId: string | null): Promise<void> {
    const { error } = await this.client
      .from("partnership_prospects")
      .update({ approved_campaign_asset_id: campaignAssetId, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`setApprovedDraft failed: ${error.message}`);
  }

  async recordContact(id: string, channel: string, contactedAt: string): Promise<void> {
    const { error } = await this.client
      .from("partnership_prospects")
      .update({ contacted_at: contactedAt, contacted_channel: channel, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`recordContact failed: ${error.message}`);
  }

  async insertInteraction(partnershipId: string, interactionType: PartnershipInteractionType, summary: string): Promise<PartnershipInteraction> {
    const { data, error } = await this.client
      .from("partnership_interactions")
      .insert({ partnership_id: partnershipId, interaction_type: interactionType, summary })
      .select()
      .single();
    if (error) throw new Error(`insertInteraction failed: ${error.message}`);
    return interactionFromRow(data);
  }

  async listInteractions(partnershipId: string): Promise<PartnershipInteraction[]> {
    const { data, error } = await this.client
      .from("partnership_interactions")
      .select()
      .eq("partnership_id", partnershipId)
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`listInteractions failed: ${error.message}`);
    return (data ?? []).map(interactionFromRow);
  }

  async recordOutcome(partnershipId: string, metric: PartnershipOutcomeMetric, value: number | null, source: PartnershipOutcomeSource, note?: string | null): Promise<void> {
    const { error } = await this.client
      .from("partnership_outcomes")
      .insert({ partnership_id: partnershipId, metric, value, source, note: note ?? null });
    if (error) throw new Error(`recordOutcome failed: ${error.message}`);
  }

  async findByNormalized(domain: string | null, handle: string | null): Promise<PartnershipProspect[]> {
    if (!domain && !handle) return [];
    const filters = [domain ? `normalized_domain.eq.${domain}` : null, handle ? `normalized_handle.eq.${handle}` : null].filter(
      (f): f is string => f !== null,
    );
    const { data, error } = await this.client.from("partnership_prospects").select().or(filters.join(","));
    if (error) throw new Error(`findByNormalized failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }
}
