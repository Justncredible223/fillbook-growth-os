import type { SupabaseClient } from "@supabase/supabase-js";
import type { Experiment, ExperimentRepository, ExperimentResult, NewExperiment } from "./types";

function fromRow(row: Record<string, any>): Experiment {
  return {
    id: row.id,
    hypothesis: row.hypothesis,
    scope: row.scope ?? {},
    guardrailNote: row.guardrail_note,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    controlWindowStart: row.control_window_start,
    createdAt: row.created_at,
    result: row.result,
  };
}

export class SupabaseExperimentRepository implements ExperimentRepository {
  constructor(private client: SupabaseClient) {}

  async list(): Promise<Experiment[]> {
    const { data, error } = await this.client.from("experiments").select().order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async get(id: string): Promise<Experiment | null> {
    const { data, error } = await this.client.from("experiments").select().eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? fromRow(data) : null;
  }

  async create(input: NewExperiment): Promise<Experiment> {
    const controlWindowStart = new Date(new Date(input.startDate).getTime() - input.controlWindowDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await this.client
      .from("experiments")
      .insert({
        hypothesis: input.hypothesis,
        scope: input.scope,
        guardrail_note: input.guardrailNote ?? null,
        status: "running",
        start_date: input.startDate,
        control_window_start: controlWindowStart,
      })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  /**
   * Persists an interim measurement WITHOUT ending the experiment -- the
   * "Check now" action. Only the `result` column changes: status stays
   * "running" and end_date stays null, so a later "Complete" still
   * computes and stores its own final result. Persisting (rather than
   * returning an in-memory result the app then loses on its next refresh)
   * is what makes the measured result actually visible to the owner.
   */
  async recordProvisionalResult(id: string, result: ExperimentResult): Promise<Experiment> {
    const { data, error } = await this.client.from("experiments").update({ result }).eq("id", id).select().single();
    if (error) throw error;
    return fromRow(data);
  }

  async complete(id: string, result: ExperimentResult, endDate: string): Promise<Experiment> {
    const { data, error } = await this.client
      .from("experiments")
      .update({ status: "completed", result, end_date: endDate })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async abort(id: string): Promise<void> {
    const { error } = await this.client.from("experiments").update({ status: "aborted" }).eq("id", id);
    if (error) throw error;
  }
}

/** Half-open [start, endExclusive) instants, as ISO strings, for both measurement windows. */
export interface ExperimentWindows {
  controlStart: string;
  controlEndExclusive: string;
  treatmentStart: string;
  treatmentEndExclusive: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * Timezone semantics, stated once: the experiment's date columns
 * (control_window_start, start_date, end_date) are calendar dates
 * interpreted as UTC days -- the same convention as everything else in
 * this backend (campaign_assets.created_at is a timestamptz, the daily
 * pipeline's "today" is the UTC calendar day). Each window is half-open:
 *
 *   control   = [control_window_start 00:00Z, start_date 00:00Z)
 *   treatment = [start_date 00:00Z, END)
 *
 * where END is the CURRENT INSTANT for a running experiment (so assets
 * created earlier today count -- previously the bound was today's date
 * string, which `.lt()` turned into "before today 00:00Z" and excluded
 * the entire current day), or the midnight AFTER end_date for a
 * completed one (so the recorded end date is included in full).
 */
export function experimentWindows(experiment: Pick<Experiment, "controlWindowStart" | "startDate" | "endDate">, now: Date): ExperimentWindows {
  const startInstant = utcMidnight(experiment.startDate);
  const treatmentEnd = experiment.endDate ? new Date(utcMidnight(experiment.endDate).getTime() + DAY_MS) : now;
  return {
    controlStart: utcMidnight(experiment.controlWindowStart).toISOString(),
    controlEndExclusive: startInstant.toISOString(),
    treatmentStart: startInstant.toISOString(),
    treatmentEndExclusive: treatmentEnd.toISOString(),
  };
}

/**
 * Real aggregation for one experiment: counts pass/fail content_scores
 * for the most recent content_versions of campaign_assets matching the
 * experiment's scope, split into the control window (before startDate)
 * and treatment window (startDate to now / end of endDate). See
 * experimentWindows() for the exact bounds and their timezone semantics.
 */
export async function measureExperiment(
  client: SupabaseClient,
  experiment: Experiment,
  now: Date,
): Promise<{ control: { successes: number; total: number }; treatment: { successes: number; total: number } }> {
  async function countPassFail(fromInstant: string, toInstantExclusive: string): Promise<{ successes: number; total: number }> {
    let query = client
      .from("campaign_assets")
      .select("id, platform, asset_type, content_versions(id, version, content_scores(verdict))")
      .gte("created_at", fromInstant)
      .lt("created_at", toInstantExclusive);
    if (experiment.scope.platform) query = query.eq("platform", experiment.scope.platform);
    if (experiment.scope.assetType) query = query.eq("asset_type", experiment.scope.assetType);

    const { data, error } = await query;
    if (error) throw error;

    let successes = 0;
    let total = 0;
    for (const asset of (data ?? []) as Array<any>) {
      const versions = (asset.content_versions ?? []) as Array<{ version: number; content_scores: Array<{ verdict: string }> }>;
      if (versions.length === 0) continue;
      const latest = versions.reduce((a, b) => (b.version > a.version ? b : a));
      const scores = latest.content_scores ?? [];
      if (scores.length === 0) continue;
      total++;
      const allPass = scores.every((s) => s.verdict === "pass");
      if (allPass) successes++;
    }
    return { successes, total };
  }

  const windows = experimentWindows(experiment, now);
  const control = await countPassFail(windows.controlStart, windows.controlEndExclusive);
  const treatment = await countPassFail(windows.treatmentStart, windows.treatmentEndExclusive);
  return { control, treatment };
}
