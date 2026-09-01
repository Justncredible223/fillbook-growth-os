import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewVerdict } from "./reviewAgents.js";

export interface ContentScoreRepository {
  save(contentVersionId: string, verdict: ReviewVerdict): Promise<void>;
}

export class InMemoryContentScoreRepository implements ContentScoreRepository {
  public saved: Array<{ contentVersionId: string; verdict: ReviewVerdict }> = [];

  async save(contentVersionId: string, verdict: ReviewVerdict): Promise<void> {
    this.saved.push({ contentVersionId, verdict });
  }
}

export class SupabaseContentScoreRepository implements ContentScoreRepository {
  constructor(private client: SupabaseClient) {}

  async save(contentVersionId: string, verdict: ReviewVerdict): Promise<void> {
    const { error } = await this.client.from("content_scores").insert({
      content_version_id: contentVersionId,
      evaluator: verdict.agent,
      verdict: verdict.pass ? "pass" : "fail",
      score: verdict.score,
      notes: verdict.issues.length > 0 ? `${verdict.reasoning} Issues: ${verdict.issues.join("; ")}` : verdict.reasoning,
    });
    if (error) throw new Error(`save content score failed: ${error.message}`);
  }
}
