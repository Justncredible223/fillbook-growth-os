import type { SupabaseClient } from "@supabase/supabase-js";

export interface NewConversionEvent {
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referralCode: string | null;
  occurredAt: string;
}

/**
 * Records one conversion reported by an external webhook (today: only
 * FillbookHQ's signup flow, source="fillbook_signup"). Throws on failure
 * rather than swallowing it, unlike cost/costTracking.ts's recordCostEvent
 * -- this is the entire point of the request (there's no discovery/reply
 * work happening alongside it to protect), so the caller (api/ingest.ts)
 * should see the failure and return a 500 rather than silently losing the
 * event.
 */
export async function recordConversionEvent(client: SupabaseClient, event: NewConversionEvent): Promise<void> {
  const { error } = await client.from("conversion_events").insert({
    source: event.source,
    utm_source: event.utmSource,
    utm_medium: event.utmMedium,
    utm_campaign: event.utmCampaign,
    utm_content: event.utmContent,
    referral_code: event.referralCode,
    occurred_at: event.occurredAt,
  });
  if (error) throw new Error(`Failed to record conversion event: ${error.message}`);
}
