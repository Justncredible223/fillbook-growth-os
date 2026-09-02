import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetStage } from "./campaignFactory.js";
import type { CampaignRepository } from "./campaignPipeline.js";

export class SupabaseCampaignRepository implements CampaignRepository {
  constructor(private client: SupabaseClient) {}

  async createCampaign(opportunityId: string, thesis: string): Promise<string> {
    const { data, error } = await this.client
      .from("campaigns")
      .insert({ opportunity_id: opportunityId, thesis })
      .select("id")
      .single();
    if (error) throw new Error(`createCampaign failed: ${error.message}`);
    return data.id as string;
  }

  async createCampaignAsset(campaignId: string, platform: string, assetType: string): Promise<string> {
    const { data, error } = await this.client
      .from("campaign_assets")
      .insert({ campaign_id: campaignId, platform, asset_type: assetType, stage: "draft" })
      .select("id")
      .single();
    if (error) throw new Error(`createCampaignAsset failed: ${error.message}`);
    return data.id as string;
  }

  async insertContentVersion(
    campaignAssetId: string,
    version: number,
    body: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await this.client
      .from("content_versions")
      .insert({ campaign_asset_id: campaignAssetId, version, body, metadata: metadata ?? {}, created_by: "system" })
      .select("id")
      .single();
    if (error) throw new Error(`insertContentVersion failed: ${error.message}`);
    return data.id as string;
  }

  async updateAssetStage(campaignAssetId: string, stage: AssetStage): Promise<void> {
    const { error } = await this.client
      .from("campaign_assets")
      .update({ stage, updated_at: new Date().toISOString() })
      .eq("id", campaignAssetId);
    if (error) throw new Error(`updateAssetStage failed: ${error.message}`);
  }
}
