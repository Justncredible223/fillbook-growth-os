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

/**
 * Real aggregation for one experiment: counts pass/fail content_scores
 * for the most recent content_versions of campaign_assets matching the
 * experiment's scope, split into the control window (before startDate)
 * and treatment window (startDate to now/endDate).
 */
export async function measureExperiment(
  client: SupabaseClient,
  experiment: Experiment,
  now: Date,
): Promise<{ control: { successes: number; total: number }; treatment: { successes: number; total: number } }> {
  async function countPassFail(fromDate: string, toDate: string): Promise<{ successes: number; total: number }> {
    let query = client
      .from("campaign_assets")
      .select("id, platform, asset_type, content_versions(id, version, content_scores(verdict))")
      .gte("created_at", fromDate)
      .lt("created_at", toDate);
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

  const treatmentEnd = experiment.endDate ?? now.toISOString().slice(0, 10);
  const control = await countPassFail(experiment.controlWindowStart, experiment.startDate);
  const treatment = await countPassFail(experiment.startDate, treatmentEnd);
  return { control, treatment };
}
