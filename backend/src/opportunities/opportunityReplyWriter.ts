import type { SupabaseClient } from "@supabase/supabase-js";
import { draftInboundResponse } from "../inbound/inboundResponseWriter.js";
import type { LlmClient } from "../content/llmClient.js";

export class OpportunityReplyError extends Error {}

interface OpportunityRow {
  id: string;
  signal_ids: string[];
}

interface SignalRow {
  id: string;
  source: string;
  source_reference: string | null;
  evidence: Record<string, unknown>;
}

/**
 * The lightweight path for "reply to this one X mention" -- reuses the
 * same single-call inboundResponseWriter the Inbound Engagement Queue
 * already uses, deliberately NOT the multi-agent campaign pipeline
 * (runCampaignForOpportunity), which is the wrong tool and the wrong
 * cost for a one-line reply. Stateless by design: nothing is persisted
 * here (no "opportunity draft" column exists or is needed) -- the draft
 * is generated fresh, returned for the owner to review, and it's the
 * owner's own copy-and-open action that does anything with it.
 *
 * Only drafts for a genuine single-signal x_mention opportunity with a
 * real source_reference -- the same rule opportunitySourceEnrichment.ts
 * uses to decide whether an opportunity gets a sourceUrl at all. A
 * multi-signal trend cluster has no one post to reply to, so this
 * refuses rather than guessing which signal to use.
 */
export async function draftOpportunityReply(
  client: SupabaseClient,
  llmClient: LlmClient,
  opportunityId: string,
  brandRulesSummary: string,
  verifiedKnowledgeSummary: string,
): Promise<string> {
  const { data: opportunity, error: oppError } = await client
    .from("opportunities")
    .select("id, signal_ids")
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) throw new OpportunityReplyError(`No opportunity with id "${opportunityId}"`);

  const row = opportunity as OpportunityRow;
  if (row.signal_ids.length !== 1) {
    throw new OpportunityReplyError("This opportunity spans multiple signals -- not a single-post engagement reply.");
  }

  const { data: signal, error: signalError } = await client
    .from("signals")
    .select("id, source, source_reference, evidence")
    .eq("id", row.signal_ids[0])
    .single();
  if (signalError || !signal) throw new OpportunityReplyError("The signal behind this opportunity no longer exists.");

  const signalRow = signal as SignalRow;
  if (signalRow.source !== "x_mention" || !signalRow.source_reference) {
    throw new OpportunityReplyError("This opportunity isn't a direct X mention -- use Build campaign instead.");
  }

  const messageText = typeof signalRow.evidence?.text === "string" ? (signalRow.evidence.text as string) : "";
  if (!messageText) throw new OpportunityReplyError("No message text recorded for this signal.");

  // Real handle when xIngestion.ts captured one for this signal (it does
  // whenever X's API resolved it); null, never guessed, otherwise.
  const authorHandle = typeof signalRow.evidence?.authorHandle === "string" ? (signalRow.evidence.authorHandle as string) : null;

  return draftInboundResponse(
    llmClient,
    {
      authorHandle,
      messageText,
      inResponseToText: null,
      isRepeatEngager: false,
      priorInteractionCount: 0,
    },
    brandRulesSummary,
    verifiedKnowledgeSummary,
  );
}
