import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity, OpportunityRepository } from "./types.js";
import { enrichWithSourceUrls, singleSignalIds, type SignalSourceRow } from "./opportunitySourceEnrichment.js";

function fromRow(data: Record<string, any>): Opportunity {
  return {
    id: data.id,
    title: data.title,
    score: Number(data.score),
    urgency: data.urgency,
    confidence: Number(data.confidence),
    rationale: data.rationale,
    recommendedChannels: data.recommended_channels,
    recommendedCampaignType: data.recommended_campaign_type,
    approvalClass: data.approval_class,
    status: data.status,
    signalIds: data.signal_ids,
    createdAt: new Date(data.created_at),
  };
}

export class SupabaseOpportunityRepository implements OpportunityRepository {
  constructor(private client: SupabaseClient) {}

  async insert(opportunity: Omit<Opportunity, "id" | "status">): Promise<Opportunity> {
    const { data, error } = await this.client
      .from("opportunities")
      .insert({
        title: opportunity.title,
        score: opportunity.score,
        urgency: opportunity.urgency,
        confidence: opportunity.confidence,
        rationale: opportunity.rationale,
        recommended_channels: opportunity.recommendedChannels,
        recommended_campaign_type: opportunity.recommendedCampaignType,
        approval_class: opportunity.approvalClass,
        signal_ids: opportunity.signalIds,
      })
      .select()
      .single();
    if (error) throw new Error(`insert opportunity failed: ${error.message}`);
    return fromRow(data);
  }

  async listOpen(): Promise<Opportunity[]> {
    const { data, error } = await this.client
      .from("opportunities")
      .select()
      .eq("status", "open")
      .order("score", { ascending: false });
    if (error) throw new Error(`listOpen failed: ${error.message}`);
    const opportunities = (data ?? []).map(fromRow);
    return this.attachSourceUrls(opportunities);
  }

  /**
   * A read-time join, not a stored column -- no migration, nothing to
   * keep in sync. See opportunitySourceEnrichment.ts for the actual
   * (unit-tested) enrichment rule.
   */
  private async attachSourceUrls(opportunities: Opportunity[]): Promise<Opportunity[]> {
    const ids = singleSignalIds(opportunities);
    if (ids.length === 0) return opportunities;

    const { data: signals, error } = await this.client
      .from("signals")
      .select("id, source, source_reference, evidence")
      .in("id", ids);
    if (error) throw new Error(`listOpen source enrichment failed: ${error.message}`);

    return enrichWithSourceUrls(opportunities, (signals ?? []) as SignalSourceRow[]);
  }
}
