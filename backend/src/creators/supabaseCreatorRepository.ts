import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Creator,
  CreatorCategory,
  CreatorInteraction,
  CreatorRepository,
  NewCreatorInteraction,
} from "./types.js";

function fromRow(data: Record<string, any>): Creator {
  return {
    id: data.id,
    handle: data.handle,
    displayName: data.display_name,
    platform: data.platform,
    category: data.category,
    readinessScore: data.readiness_score === null ? null : Number(data.readiness_score),
    followerCount: data.follower_count === null ? null : Number(data.follower_count),
    creatorProductMoment: data.creator_product_moment,
    notes: data.notes,
    rejectionReason: data.rejection_reason,
    lastInteractionAt: data.last_interaction_at,
    sourceDoc: data.source_doc,
  };
}

function interactionFromRow(data: Record<string, any>): CreatorInteraction {
  return {
    id: data.id,
    creatorId: data.creator_id,
    interactionType: data.interaction_type,
    occurredAt: data.occurred_at,
    summary: data.summary,
    confirmed: data.confirmed,
    sourceDoc: data.source_doc,
  };
}

export class SupabaseCreatorRepository implements CreatorRepository {
  constructor(private client: SupabaseClient) {}

  async listAll(): Promise<Creator[]> {
    const { data, error } = await this.client
      .from("creators")
      .select()
      .order("category")
      .order("readiness_score", { ascending: false, nullsFirst: false });
    if (error) throw new Error(`listAll creators failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }

  async listByCategory(category: CreatorCategory): Promise<Creator[]> {
    const { data, error } = await this.client
      .from("creators")
      .select()
      .eq("category", category)
      .order("readiness_score", { ascending: false, nullsFirst: false });
    if (error) throw new Error(`listByCategory failed: ${error.message}`);
    return (data ?? []).map(fromRow);
  }

  async updateReadiness(creatorId: string, readinessScore: number, lastInteractionAt: string): Promise<void> {
    const { error } = await this.client
      .from("creators")
      .update({ readiness_score: readinessScore, last_interaction_at: lastInteractionAt, updated_at: new Date().toISOString() })
      .eq("id", creatorId);
    if (error) throw new Error(`updateReadiness failed: ${error.message}`);
  }

  async insertInteraction(creatorId: string, interaction: NewCreatorInteraction): Promise<CreatorInteraction> {
    const { data, error } = await this.client
      .from("creator_interactions")
      .insert({
        creator_id: creatorId,
        interaction_type: interaction.interactionType,
        occurred_at: interaction.occurredAt,
        summary: interaction.summary,
        confirmed: interaction.confirmed,
        source_doc: interaction.sourceDoc ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`insertInteraction failed: ${error.message}`);
    return interactionFromRow(data);
  }
}

/**
 * Standalone (not a CreatorRepository method) since it's only needed by
 * inbound ingestion to link a mention's author to an existing tracked
 * creator -- case-insensitive because handles arrive from two different
 * sources (X's API, manual creator entries) with no guaranteed casing.
 */
export async function findCreatorIdByHandle(client: SupabaseClient, handle: string): Promise<string | null> {
  const { data, error } = await client.from("creators").select("id").ilike("handle", handle).maybeSingle();
  if (error) throw new Error(`findCreatorIdByHandle failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}
