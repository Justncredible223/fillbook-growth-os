import { describe, it, expect, vi } from "vitest";
import { JobQueue } from "../src/jobs/jobQueue";
import { InMemoryJobQueueRepository } from "../src/jobs/inMemoryJobQueueRepository";

describe("JobQueue", () => {
  it("enqueues and processes a job successfully", async () => {
    const repo = new InMemoryJobQueueRepository();
    const queue = new JobQueue(repo);
    await queue.enqueue({ jobType: "signal.ingest", payload: { source: "public_web" } });

    const handler = vi.fn().mockResolvedValue(undefined);
    const processed = await queue.processOne(handler);

    expect(processed).not.toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(repo._all()[0]!.status).toBe("succeeded");
  });

  it("returns null when the queue is empty", async () => {
    const queue = new JobQueue(new InMemoryJobQueueRepository());
    const result = await queue.processOne(vi.fn());
    expect(result).toBeNull();
  });

  it("deduplicates enqueues sharing an idempotency key", async () => {
    const repo = new InMemoryJobQueueRepository();
    const queue = new JobQueue(repo);
    const a = await queue.enqueue({
      jobType: "content.render_video",
      payload: {},
      idempotencyKey: "campaign-asset-42",
    });
    const b = await queue.enqueue({
      jobType: "content.render_video",
      payload: {},
      idempotencyKey: "campaign-asset-42",
    });
    expect(a.id).toBe(b.id);
    expect(repo._all()).toHaveLength(1);
  });

  it("retries a failed job with backoff instead of losing it", async () => {
    const repo = new InMemoryJobQueueRepository();
    const queue = new JobQueue(repo);
    await queue.enqueue({ jobType: "seo.check_rankings", payload: {}, maxAttempts: 5 });

    const failingHandler = vi.fn().mockRejectedValue(new Error("transient network error"));
    await queue.processOne(failingHandler);

    const job = repo._all()[0]!;
    expect(job.status).toBe("pending"); // back in the queue, not lost
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBe("transient network error");
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("moves a job to dead_letter after max_attempts consecutive failures", async () => {
    const repo = new InMemoryJobQueueRepository();
    const queue = new JobQueue(repo);
    await queue.enqueue({ jobType: "video.render", payload: {}, maxAttempts: 2, runAfter: new Date(0) });

    const failingHandler = vi.fn().mockRejectedValue(new Error("render crashed"));
    // Force run_after back to the past between attempts so claimNext picks it up again.
    await queue.processOne(failingHandler);
    repo._all()[0]!.runAfter = new Date(0);
    await queue.processOne(failingHandler);

    const job = repo._all()[0]!;
    expect(job.attempts).toBe(2);
    expect(job.status).toBe("dead_letter");
  });

  it("never produces duplicate successful drafts for the same idempotency key even under a retry", async () => {
    const repo = new InMemoryJobQueueRepository();
    const queue = new JobQueue(repo);
    await queue.enqueue({
      jobType: "content.draft",
      payload: {},
      idempotencyKey: "opp-7-asset-x",
      runAfter: new Date(0),
    });

    let calls = 0;
    const flakyHandler = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error("flaked once");
    });

    await queue.processOne(flakyHandler); // fails, goes back to pending
    repo._all()[0]!.runAfter = new Date(0);
    await queue.processOne(flakyHandler); // succeeds

    expect(repo._all()).toHaveLength(1); // still exactly one job row
    expect(repo._all()[0]!.status).toBe("succeeded");
    expect(calls).toBe(2);
  });
});
