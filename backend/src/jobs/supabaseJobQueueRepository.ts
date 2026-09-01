import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnqueueInput, Job, JobQueueRepository, JobStatus } from "./types.js";

interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  last_error: string | null;
}

function fromRow(row: JobRow): Job {
  return {
    id: row.id,
    jobType: row.job_type,
    payload: row.payload,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: new Date(row.run_after),
    lastError: row.last_error,
  };
}

/** Real implementation backed by the Postgres functions in migration 0003. */
export class SupabaseJobQueueRepository implements JobQueueRepository {
  constructor(private client: SupabaseClient) {}

  async enqueue(input: EnqueueInput): Promise<Job> {
    const { data, error } = await this.client
      .from("system_jobs")
      .upsert(
        {
          job_type: input.jobType,
          payload: input.payload,
          idempotency_key: input.idempotencyKey ?? null,
          max_attempts: input.maxAttempts ?? 5,
          run_after: (input.runAfter ?? new Date()).toISOString(),
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      )
      .select()
      .single();
    if (error) throw new Error(`enqueue failed: ${error.message}`);
    return fromRow(data as JobRow);
  }

  async claimNext(jobTypes?: string[]): Promise<Job | null> {
    const { data, error } = await this.client.rpc("claim_job", {
      p_job_types: jobTypes ?? null,
    });
    if (error) throw new Error(`claim_job failed: ${error.message}`);
    const rows = data as JobRow[] | null;
    if (!rows || rows.length === 0) return null;
    return fromRow(rows[0]!);
  }

  async markSucceeded(jobId: string): Promise<void> {
    const { error } = await this.client.rpc("complete_job", { p_job_id: jobId });
    if (error) throw new Error(`complete_job failed: ${error.message}`);
  }

  async markFailed(jobId: string, errorMessage: string, runAfter: Date, deadLetter: boolean): Promise<void> {
    const { error } = await this.client.rpc("fail_job", {
      p_job_id: jobId,
      p_error: errorMessage,
      p_run_after: runAfter.toISOString(),
      p_dead_letter: deadLetter,
    });
    if (error) throw new Error(`fail_job failed: ${error.message}`);
  }
}
