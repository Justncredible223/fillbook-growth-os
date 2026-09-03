import type { Opportunity } from "./types.js";

export interface SignalSourceRow {
  id: string;
  source: string;
  source_reference: string | null;
  evidence?: Record<string, unknown> | null;
}

/**
 * Pure enrichment step, split out from SupabaseOpportunityRepository so
 * it's unit-testable without a live/mocked Supabase client -- see
 * autoDraftEligibility.ts for the same pattern elsewhere in this module.
 * Attaches a real sourceUrl (and, when the signal's evidence actually has
 * one, authorHandle) only when an opportunity traces back to exactly one
 * signal whose source is 'x_mention' and that signal has a
 * source_reference. Never fabricates a value -- authorHandle is only
 * ever the exact string xIngestion.ts captured from X's own API
 * response; a multi-signal trend cluster, a non-X-mention signal, or a
 * mention X never resolved a handle for is left without one.
 */
export function enrichWithSourceUrls(opportunities: Opportunity[], signalRows: SignalSourceRow[]): Opportunity[] {
  const signalById = new Map(signalRows.map((s) => [s.id, s]));

  return opportunities.map((o) => {
    if (o.signalIds.length !== 1) return o;
    const signal = signalById.get(o.signalIds[0]!);
    if (!signal || signal.source !== "x_mention" || !signal.source_reference) return o;
    const authorHandle = signal.evidence?.authorHandle;
    return {
      ...o,
      sourceUrl: signal.source_reference,
      ...(typeof authorHandle === "string" && authorHandle ? { authorHandle } : {}),
    };
  });
}

/** The signal ids worth fetching for enrichment -- only single-signal opportunities can ever get a sourceUrl. */
export function singleSignalIds(opportunities: Opportunity[]): string[] {
  return opportunities.filter((o) => o.signalIds.length === 1).map((o) => o.signalIds[0]!);
}
