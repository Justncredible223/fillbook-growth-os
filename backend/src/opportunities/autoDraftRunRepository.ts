import type { SupabaseClient } from "@supabase/supabase-js";

export type AutoDraftRunStatus = "drafted" | "skipped" | "failed";

export interface AutoDraftRunOutcome {
  status: AutoDraftRunStatus;
  skipReason?: string | null;
  opportunityId?: string | null;
  campaignId?: string | null;
  opportunitiesConsidered: number;
  opportunitiesEligible: number;
  aiCalls: number;
  costUsd?: number | null;
  durationMs: number;
  error?: string | null;
}

export interface AutoDraftRunSummary {
  runDate: string;
  status: AutoDraftRunStatus;
  skipReason: string | null;
  costUsd: number | null;
}

export interface AutoDraftRunRepository {
  /**
   * Attempts to claim today's run via a durable, DB-level unique
   * constraint on run_date -- not in-memory state. Returns the claimed
   * row's id on success, or null if a run for this date was already
   * claimed (by this invocation or a concurrent/retried one). This is
   * the entire idempotency mechanism: call this FIRST, before any
   * drafting work, and stop immediately on null.
   */
  claimRun(runDate: string): Promise<string | null>;
  completeRun(id: string, outcome: AutoDraftRunOutcome): Promise<void>;
  getLastRun(): Promise<AutoDraftRunSummary | null>;
  /** Sum of cost_usd for all 'drafted' runs in the given calendar month (YYYY-MM). */
  getMonthSpendUsd(yearMonth: string): Promise<number>;
}

export class InMemoryAutoDraftRunRepository implements AutoDraftRunRepository {
  private runs = new Map<string, { id: string; runDate: string; outcome?: AutoDraftRunOutcome }>();
  private counter = 0;

  async claimRun(runDate: string): Promise<string | null> {
    if (this.runs.has(runDate)) return null;
    const id = `auto-draft-run-${++this.counter}`;
    this.runs.set(runDate, { id, runDate });
    return id;
  }

  async completeRun(id: string, outcome: AutoDraftRunOutcome): Promise<void> {
    for (const run of this.runs.values()) {
      if (run.id === id) run.outcome = outcome;
    }
  }

  async getLastRun(): Promise<AutoDraftRunSummary | null> {
    const sorted = [...this.runs.values()].sort((a, b) => (a.runDate < b.runDate ? 1 : -1));
    const last = sorted[0];
    if (!last?.outcome) return null;
    return {
      runDate: last.runDate,
      status: last.outcome.status,
      skipReason: last.outcome.skipReason ?? null,
      costUsd: last.outcome.costUsd ?? null,
    };
  }

  async getMonthSpendUsd(yearMonth: string): Promise<number> {
    let sum = 0;
    for (const run of this.runs.values()) {
      if (run.runDate.startsWith(yearMonth) && run.outcome?.status === "drafted") {
        sum += run.outcome.costUsd ?? 0;
      }
    }
    return sum;
  }
}

export class SupabaseAutoDraftRunRepository implements AutoDraftRunRepository {
  constructor(private client: SupabaseClient) {}

  async claimRun(runDate: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("auto_draft_runs")
      .insert({ run_date: runDate, status: "skipped", skip_reason: "in_progress" })
      .select("id")
      .single();
    if (error) {
      // Postgres unique_violation -- another invocation already claimed today.
      if (error.code === "23505") return null;
      throw new Error(`claimRun failed: ${error.message}`);
    }
    return data.id as string;
  }

  async completeRun(id: string, outcome: AutoDraftRunOutcome): Promise<void> {
    const { error } = await this.client
      .from("auto_draft_runs")
      .update({
        status: outcome.status,
        skip_reason: outcome.skipReason ?? null,
        opportunity_id: outcome.opportunityId ?? null,
        campaign_id: outcome.campaignId ?? null,
        opportunities_considered: outcome.opportunitiesConsidered,
        opportunities_eligible: outcome.opportunitiesEligible,
        ai_calls: outcome.aiCalls,
        cost_usd: outcome.costUsd ?? null,
        duration_ms: outcome.durationMs,
        error: outcome.error ?? null,
      })
      .eq("id", id);
    if (error) throw new Error(`completeRun failed: ${error.message}`);
  }

  async getLastRun(): Promise<AutoDraftRunSummary | null> {
    const { data, error } = await this.client
      .from("auto_draft_runs")
      .select("run_date, status, skip_reason, cost_usd")
      .order("run_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getLastRun failed: ${error.message}`);
    if (!data) return null;
    return {
      runDate: data.run_date,
      status: data.status,
      skipReason: data.skip_reason,
      costUsd: data.cost_usd === null ? null : Number(data.cost_usd),
    };
  }

  async getMonthSpendUsd(yearMonth: string): Promise<number> {
    // run_date is a `date` column -- Postgres has no LIKE operator for
    // it, so this must be a real range comparison, not string matching
    // (reproduced live: "operator does not exist: date ~~ unknown").
    const [year, month] = yearMonth.split("-").map(Number);
    const monthStart = `${yearMonth}-01`;
    const nextMonth = month === 12 ? `${year! + 1}-01-01` : `${yearMonth.slice(0, 5)}${String(month! + 1).padStart(2, "0")}-01`;
    const { data, error } = await this.client
      .from("auto_draft_runs")
      .select("cost_usd")
      .eq("status", "drafted")
      .gte("run_date", monthStart)
      .lt("run_date", nextMonth);
    if (error) throw new Error(`getMonthSpendUsd failed: ${error.message}`);
    return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  }
}
