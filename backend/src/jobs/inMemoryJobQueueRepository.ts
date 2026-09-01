import type { EnqueueInput, Job, JobQueueRepository } from "./types";

/** Test-only in-memory fake mirroring the Postgres functions' semantics. */
export class InMemoryJobQueueRepository implements JobQueueRepository {
  private jobs = new Map<string, Job>();
  private nextId = 1;

  async enqueue(input: EnqueueInput): Promise<Job> {
    if (input.idempotencyKey) {
      const existing = [...this.jobs.values()].find(
        (j) => j.idempotencyKey === input.idempotencyKey,
      );
      if (existing) return existing;
    }
    const job: Job = {
      id: `job_${this.nextId++}`,
      jobType: input.jobType,
      payload: input.payload,
      status: "pending",
      idempotencyKey: input.idempotencyKey ?? null,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
      runAfter: input.runAfter ?? new Date(0),
      lastError: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async claimNext(jobTypes?: string[]): Promise<Job | null> {
    const now = new Date();
    const candidate = [...this.jobs.values()]
      .filter(
        (j) =>
          j.status === "pending" &&
          j.runAfter <= now &&
          (!jobTypes || jobTypes.includes(j.jobType)),
      )
      .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];
    if (!candidate) return null;
    candidate.status = "running";
    candidate.attempts += 1;
    return candidate;
  }

  async markSucceeded(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job) job.status = "succeeded";
  }

  async markFailed(jobId: string, error: string, runAfter: Date, deadLetter: boolean): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.lastError = error;
    job.runAfter = runAfter;
    job.status = deadLetter ? "dead_letter" : "pending";
  }

  /** Test helper only. */
  _all(): Job[] {
    return [...this.jobs.values()];
  }
}
