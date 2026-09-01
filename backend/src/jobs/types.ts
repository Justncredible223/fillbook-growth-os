export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "dead_letter";

export interface Job {
  id: string;
  jobType: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
}

export interface EnqueueInput {
  jobType: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  maxAttempts?: number;
  runAfter?: Date;
}

/**
 * Storage contract for the job queue. The Supabase-backed implementation
 * and the in-memory test fake both satisfy this — tests never touch the
 * network.
 */
export interface JobQueueRepository {
  enqueue(input: EnqueueInput): Promise<Job>;
  claimNext(jobTypes?: string[]): Promise<Job | null>;
  markSucceeded(jobId: string): Promise<void>;
  markFailed(jobId: string, error: string, runAfter: Date, deadLetter: boolean): Promise<void>;
}
