import type { Opportunity } from "./types.js";

export interface SignalSourceRow {
  id: string;
  source: string;
  source_reference: string | null;
}

/**
 * Pure enrichment step, split out from SupabaseOpportunityRepository so
 * it's unit-testable without a live/mocked Supabase client -- see
 * autoDraftEligibility.ts for the same pattern elsewhere in this module.
 * Attaches a real sourceUrl only when an opportunity traces back to
 * exactly one signal whose source is 'x_mention' and that signal actually
 * has a source_reference. Never fabricates a value; a multi-signal trend
 * cluster or a non-X-mention signal is returned unchanged.
 */
export function enrichWithSourceUrls(opportunities: Opportunity[], signalRows: SignalSourceRow[]): Opportunity[] {
  const signalById = new Map(signalRows.map((s) => [s.id, s]));

  return opportunities.map((o) => {
    if (o.signalIds.length !== 1) return o;
    const signal = signalById.get(o.signalIds[0]!);
    if (!signal || signal.source !== "x_mention" || !signal.source_reference) return o;
    return { ...o, sourceUrl: signal.source_reference };
  });
}

/** The signal ids worth fetching for enrichment -- only single-signal opportunities can ever get a sourceUrl. */
export function singleSignalIds(opportunities: Opportunity[]): string[] {
  return opportunities.filter((o) => o.signalIds.length === 1).map((o) => o.signalIds[0]!);
}
