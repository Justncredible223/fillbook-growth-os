import type { SupabaseClient } from "@supabase/supabase-js";
import { selectStyleExamples, type StyleExample } from "../prospecting/prospectingStyleExamples.js";

/**
 * Inbound counterpart to prospectingStyleExamples.ts: the owner's edited
 * replies to people who engaged with us (inbound_engagements.final_response,
 * migration 0036), shown to the drafter as tone examples. Same rules: only
 * real edits, never a link, and any failure returns [] so drafting is never
 * blocked by a style lookup.
 */
export async function loadInboundStyleExamples(client: SupabaseClient, limit = 4): Promise<StyleExample[]> {
  try {
    const { data, error } = await client
      .from("inbound_engagements")
      .select("body, draft_response, final_response")
      .eq("status", "responded")
      .not("final_response", "is", null)
      .order("responded_at", { ascending: false })
      .limit(limit * 3);
    if (error || !data) return [];
    return selectStyleExamples(
      (data as Array<{ body: string | null; draft_response: string | null; final_response: string | null }>).map((r) => ({
        post_text: r.body,
        draft_reply: r.draft_response,
        final_reply: r.final_response,
      })),
      limit,
    );
  } catch {
    return [];
  }
}
