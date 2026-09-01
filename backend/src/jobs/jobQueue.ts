import { decideRetry } from "./backoff";
import type { EnqueueInput, Job, JobQueueRepository } from "./types";

export type JobHandler = (job: Job) => Promise<void>;

/**
 * Orchestrates claim -> handle -> succeed/fail against an injected
 * repository. This is what both the Vercel Cron worker endpoint (real DB)
 * and tests (in-memory fake) drive.
 */
export class JobQueue {
  constructor(private repo: JobQueueRepository) {}

  enqueue(input: EnqueueInput): Promise<Job> {
    return this.repo.enqueue(input);
  }

  /**
   * Claims and processes exactly one job, if one is available. Returns
   * null if the queue is empty. Never throws for a handler failure — that
   * failure is captured and routed through the retry/dead-letter decision.
   */
  async processOne(handler: JobHandler, jobTypes?: string[]): Promise<Job | null> {
    const job = await this.repo.claimNext(jobTypes);
    if (!job) return null;

    try {
      await handler(job);
      await this.repo.markSucceeded(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const decision = decideRetry(job.attempts, job.maxAttempts);
      await this.repo.markFailed(job.id, message, decision.runAfter, decision.deadLetter);
    }
    return job;
  }
}
