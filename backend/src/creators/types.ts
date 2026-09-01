export type CreatorPlatform = "x" | "tiktok" | "youtube" | "discord" | "other";
export type CreatorCategory = "tier_b" | "research_next" | "rejected";
export type InteractionType = "x_reply" | "youtube_comment" | "tiktok_comment" | "other";

export interface Creator {
  id: string;
  handle: string;
  displayName: string | null;
  platform: CreatorPlatform;
  category: CreatorCategory;
  /** 0 (discovered) to 10 (organic advocate). Null for rejected creators. */
  readinessScore: number | null;
  followerCount: number | null;
  creatorProductMoment: string | null;
  notes: string | null;
  rejectionReason: string | null;
  lastInteractionAt: string | null;
  sourceDoc: string;
}

export interface CreatorInteraction {
  id: string;
  creatorId: string;
  interactionType: InteractionType;
  occurredAt: string;
  summary: string;
  confirmed: boolean;
  sourceDoc: string | null;
}

export interface NewCreatorInteraction {
  interactionType: InteractionType;
  occurredAt: string;
  summary: string;
  confirmed: boolean;
  sourceDoc?: string | null;
}

export interface CreatorRepository {
  listAll(): Promise<Creator[]>;
  listByCategory(category: CreatorCategory): Promise<Creator[]>;
  updateReadiness(creatorId: string, readinessScore: number, lastInteractionAt: string): Promise<void>;
  insertInteraction(creatorId: string, interaction: NewCreatorInteraction): Promise<CreatorInteraction>;
}
