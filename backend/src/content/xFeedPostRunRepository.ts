import type { SupabaseClient } from "@supabase/supabase-js";
import type { XFeedPostRun, XFeedPostRunRepository, XFeedPostRunStatus } from "./dailyXFeedPost.js";

export class InMemoryXFeedPostRunRepository implements XFeedPostRunRepository {
  private runs = new Map<string, XFeedPostRun>(); // keyed by operating_date
  private byId = new Map<string, string>(); // id -> operating_date
  private counter = 0;
  /** Test hook: overrides "now" for updated_at stamping, so staleness/CAS races are directly testable. */
  clock: () => Date = () => new Date();
  private lastStampMs = 0;

  /**
   * Real Postgres UPDATEs get a genuinely distinct `now()` per statement
   * (real network latency between calls in production means two writes
   * are never actually the same millisecond in practice). A synchronous
   * in-memory test calling `this.clock().toISOString()` back-to-back has
   * no such guarantee -- two writes executed in the same JS tick can
   * collide on the exact same millisecond, which would make the
   * updatedAt-based CAS token accidentally ambiguous in a fast test even
   * though it's realistically never ambiguous against a real database.
   * Monotonically bumping guarantees every write this fake makes gets a
   * strictly distinct token, matching what production actually provides.
   */
  private nextUpdatedAt(): string {
    this.lastStampMs = Math.max(this.clock().getTime(), this.lastStampMs + 1);
    return new Date(this.lastStampMs).toISOString();
  }

  async getRun(operatingDate: string): Promise<XFeedPostRun | null> {
    const run = this.runs.get(operatingDate);
    return run ? { ...run } : null;
  }

  async claimRun(operatingDate: string): Promise<string | null> {
    if (this.runs.has(operatingDate)) return null;
    const id = `x-feed-post-run-${++this.counter}`;
    this.runs.set(operatingDate, {
      id,
      operatingDate,
      status: "running",
      campaignAssetId: null,
      topicKey: null,
      triedTopicKeys: [],
      attempts: 0,
      aiCalls: 0,
      costUsd: 0,
      error: null,
      postedAt: null,
      updatedAt: this.nextUpdatedAt(),
      editorialTags: [],
      selectionReason: null,
      postedText: null,
    });
    this.byId.set(id, operatingDate);
    return id;
  }

  /**
   * Compare-and-swap: only transitions to 'running' if the row's CURRENT
   * status and updatedAt still match what the caller last read. Mirrors
   * the Supabase impl's atomic conditional UPDATE exactly (single
   * synchronous check-then-write here, since JS has no concurrent access
   * to this in-memory map within one process) -- what matters for tests
   * is the OUTCOME contract (only one caller can ever win for the same
   * expected state), not the mechanism.
   */
  async tryClaimForAttempt(operatingDate: string, expected: { status: XFeedPostRunStatus; updatedAt: string; campaignAssetId?: string | null }): Promise<boolean> {
    const run = this.runs.get(operatingDate);
    if (!run) return false;
    if (run.status !== expected.status || run.updatedAt !== expected.updatedAt) return false;
    if (expected.campaignAssetId !== undefined && run.campaignAssetId !== expected.campaignAssetId) return false;
    run.status = "running";
    run.updatedAt = this.nextUpdatedAt();
    return true;
  }

  async recordAttemptProgress(
    id: string,
    expectedUpdatedAt: string,
    patch: { topicKey?: string; triedTopicKeys?: string[]; editorialTags?: string[]; selectionReason?: string; aiCallsDelta?: number; costUsdDelta?: number },
  ): Promise<{ ok: true; updatedAt: string } | { ok: false }> {
    const run = this.getById(id);
    if (!run || run.updatedAt !== expectedUpdatedAt) return { ok: false };
    if (patch.topicKey !== undefined) run.topicKey = patch.topicKey;
    if (patch.triedTopicKeys !== undefined) run.triedTopicKeys = patch.triedTopicKeys;
    if (patch.editorialTags !== undefined) run.editorialTags = patch.editorialTags;
    if (patch.selectionReason !== undefined) run.selectionReason = patch.selectionReason;
    if (patch.aiCallsDelta !== undefined) run.aiCalls += patch.aiCallsDelta;
    if (patch.costUsdDelta !== undefined) run.costUsd += patch.costUsdDelta;
    run.updatedAt = this.nextUpdatedAt();
    return { ok: true, updatedAt: run.updatedAt };
  }

  async finalizeAttempt(
    id: string,
    expectedUpdatedAt: string,
    outcome: {
      status: XFeedPostRunStatus;
      campaignAssetId?: string | null;
      topicKey?: string | null;
      triedTopicKeys: string[];
      attempts: number;
      aiCalls: number;
      costUsd: number;
      error?: string | null;
    },
  ): Promise<boolean> {
    const run = this.getById(id);
    if (!run || run.updatedAt !== expectedUpdatedAt) return false;
    run.status = outcome.status;
    run.campaignAssetId = outcome.campaignAssetId ?? null;
    run.topicKey = outcome.topicKey ?? null;
    run.triedTopicKeys = outcome.triedTopicKeys;
    run.attempts = outcome.attempts;
    run.aiCalls = outcome.aiCalls;
    run.costUsd = outcome.costUsd;
    run.error = outcome.error ?? null;
    run.updatedAt = this.nextUpdatedAt();
    return true;
  }

  async completeRun(
    id: string,
    outcome: {
      status: XFeedPostRunStatus;
      campaignAssetId?: string | null;
      topicKey?: string | null;
      triedTopicKeys: string[];
      attempts: number;
      aiCalls: number;
      costUsd: number;
      error?: string | null;
    },
  ): Promise<void> {
    const run = this.getById(id);
    if (!run) return;
    run.status = outcome.status;
    run.campaignAssetId = outcome.campaignAssetId ?? null;
    run.topicKey = outcome.topicKey ?? null;
    run.triedTopicKeys = outcome.triedTopicKeys;
    run.attempts = outcome.attempts;
    run.aiCalls = outcome.aiCalls;
    run.costUsd = outcome.costUsd;
    run.error = outcome.error ?? null;
    run.updatedAt = this.nextUpdatedAt();
  }

  async getMonthSpendUsd(yearMonth: string): Promise<number> {
    let sum = 0;
    for (const run of this.runs.values()) {
      if (run.operatingDate.startsWith(yearMonth)) sum += run.costUsd;
    }
    return sum;
  }

  async listRecentRuns(sinceOperatingDate: string): Promise<XFeedPostRun[]> {
    return [...this.runs.values()]
      .filter((r) => r.operatingDate >= sinceOperatingDate)
      .sort((a, b) => (a.operatingDate < b.operatingDate ? 1 : -1))
      .map((r) => ({ ...r }));
  }

  /** Test/dev helper + real markPosted: records the owner's final confirmed text alongside marking posted. */
  async markPosted(operatingDate: string, postedAt: string, postedText: string): Promise<void> {
    const run = this.runs.get(operatingDate);
    if (run) {
      run.postedAt = postedAt;
      run.postedText = postedText;
    }
  }

  /** Test-only helper: force a row's updated_at backward to simulate a stale/abandoned 'running' claim. */
  backdateUpdatedAt(operatingDate: string, isoTimestamp: string): void {
    const run = this.runs.get(operatingDate);
    if (run) run.updatedAt = isoTimestamp;
  }

  private getById(id: string): XFeedPostRun | undefined {
    const date = this.byId.get(id);
    return date ? this.runs.get(date) : undefined;
  }
}

function fromRow(row: Record<string, any>): XFeedPostRun {
  return {
    id: row.id,
    operatingDate: row.operating_date,
    status: row.status,
    campaignAssetId: row.campaign_asset_id,
    topicKey: row.topic_key,
    triedTopicKeys: row.tried_topic_keys ?? [],
    attempts: row.attempts,
    aiCalls: row.ai_calls,
    costUsd: Number(row.cost_usd),
    error: row.error,
    postedAt: row.posted_at,
    updatedAt: row.updated_at,
    editorialTags: row.editorial_tags ?? [],
    selectionReason: row.selection_reason ?? null,
    postedText: row.posted_text ?? null,
  };
}

export class SupabaseXFeedPostRunRepository implements XFeedPostRunRepository {
  constructor(private client: SupabaseClient) {}

  async getRun(operatingDate: string): Promise<XFeedPostRun | null> {
    const { data, error } = await this.client.from("x_feed_post_runs").select().eq("operating_date", operatingDate).maybeSingle();
    if (error) throw new Error(`getRun failed: ${error.message}`);
    return data ? fromRow(data) : null;
  }

  async claimRun(operatingDate: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("x_feed_post_runs")
      .insert({ operating_date: operatingDate, status: "running" })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return null; // unique_violation -- another invocation already claimed today
      throw new Error(`claimRun failed: ${error.message}`);
    }
    return data.id as string;
  }

  /**
   * A single conditional UPDATE, atomic at the database level: Postgres
   * only matches (and changes) the row if operating_date AND status AND
   * updated_at (AND campaign_asset_id, when given) ALL still hold at the
   * instant this statement runs -- there is no read-then-write gap for a
   * concurrent invocation to land in. `.select()` returns the updated row
   * only when the UPDATE actually matched something; an empty result
   * means this call lost the race (or the caller's view of the row was
   * already stale), and the caller must re-read rather than assume it
   * now owns the attempt-sequence.
   */
  async tryClaimForAttempt(operatingDate: string, expected: { status: XFeedPostRunStatus; updatedAt: string; campaignAssetId?: string | null }): Promise<boolean> {
    let query = this.client
      .from("x_feed_post_runs")
      .update({ status: "running", updated_at: new Date().toISOString() })
      .eq("operating_date", operatingDate)
      .eq("status", expected.status)
      .eq("updated_at", expected.updatedAt);
    if (expected.campaignAssetId !== undefined) {
      query = expected.campaignAssetId === null ? query.is("campaign_asset_id", null) : query.eq("campaign_asset_id", expected.campaignAssetId);
    }
    const { data, error } = await query.select("id");
    if (error) throw new Error(`tryClaimForAttempt failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  /**
   * Same atomic conditional-UPDATE pattern as tryClaimForAttempt, applied
   * to in-flight progress writes: the `.eq("updated_at", expectedUpdatedAt)`
   * clause is what makes this safe against a straggling worker whose claim
   * was superseded by a stale-reclaim -- its write simply matches zero
   * rows once the row's real updated_at has moved on. Returns the row's
   * fresh updated_at (read back via `.select()`) so the caller can chain
   * the next conditional write without a separate round-trip.
   */
  async recordAttemptProgress(
    id: string,
    expectedUpdatedAt: string,
    patch: { topicKey?: string; triedTopicKeys?: string[]; editorialTags?: string[]; selectionReason?: string; aiCallsDelta?: number; costUsdDelta?: number },
  ): Promise<{ ok: true; updatedAt: string } | { ok: false }> {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.topicKey !== undefined) update.topic_key = patch.topicKey;
    if (patch.triedTopicKeys !== undefined) update.tried_topic_keys = patch.triedTopicKeys;
    if (patch.editorialTags !== undefined) update.editorial_tags = patch.editorialTags;
    if (patch.selectionReason !== undefined) update.selection_reason = patch.selectionReason;

    if (patch.aiCallsDelta !== undefined || patch.costUsdDelta !== undefined) {
      // Deltas require the row's CURRENT numeric values, which a plain
      // conditional UPDATE can't express without a read -- but the read
      // happens under the same expectedUpdatedAt guard, so it's still
      // race-safe: if the row has moved on since, this returns null and
      // the whole call reports failure without writing anything.
      const { data: current, error: readError } = await this.client
        .from("x_feed_post_runs")
        .select("ai_calls, cost_usd")
        .eq("id", id)
        .eq("updated_at", expectedUpdatedAt)
        .maybeSingle();
      if (readError) throw new Error(`recordAttemptProgress read failed: ${readError.message}`);
      if (!current) return { ok: false };
      if (patch.aiCallsDelta !== undefined) update.ai_calls = (current.ai_calls ?? 0) + patch.aiCallsDelta;
      if (patch.costUsdDelta !== undefined) update.cost_usd = Number(current.cost_usd ?? 0) + patch.costUsdDelta;
    }

    const { data, error } = await this.client.from("x_feed_post_runs").update(update).eq("id", id).eq("updated_at", expectedUpdatedAt).select("updated_at");
    if (error) throw new Error(`recordAttemptProgress failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ updated_at: string }>;
    return rows.length > 0 ? { ok: true, updatedAt: rows[0]!.updated_at } : { ok: false };
  }

  async finalizeAttempt(
    id: string,
    expectedUpdatedAt: string,
    outcome: {
      status: XFeedPostRunStatus;
      campaignAssetId?: string | null;
      topicKey?: string | null;
      triedTopicKeys: string[];
      attempts: number;
      aiCalls: number;
      costUsd: number;
      error?: string | null;
    },
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("x_feed_post_runs")
      .update({
        status: outcome.status,
        campaign_asset_id: outcome.campaignAssetId ?? null,
        topic_key: outcome.topicKey ?? null,
        tried_topic_keys: outcome.triedTopicKeys,
        attempts: outcome.attempts,
        ai_calls: outcome.aiCalls,
        cost_usd: outcome.costUsd,
        error: outcome.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select("id");
    if (error) throw new Error(`finalizeAttempt failed: ${error.message}`);
    return (data ?? []).length > 0;
  }

  async completeRun(
    id: string,
    outcome: {
      status: XFeedPostRunStatus;
      campaignAssetId?: string | null;
      topicKey?: string | null;
      triedTopicKeys: string[];
      attempts: number;
      aiCalls: number;
      costUsd: number;
      error?: string | null;
    },
  ): Promise<void> {
    const { error } = await this.client
      .from("x_feed_post_runs")
      .update({
        status: outcome.status,
        campaign_asset_id: outcome.campaignAssetId ?? null,
        topic_key: outcome.topicKey ?? null,
        tried_topic_keys: outcome.triedTopicKeys,
        attempts: outcome.attempts,
        ai_calls: outcome.aiCalls,
        cost_usd: outcome.costUsd,
        error: outcome.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(`completeRun failed: ${error.message}`);
  }

  async getMonthSpendUsd(yearMonth: string): Promise<number> {
    const [year, month] = yearMonth.split("-").map(Number);
    const monthStart = `${yearMonth}-01`;
    const nextMonth = month === 12 ? `${year! + 1}-01-01` : `${yearMonth.slice(0, 5)}${String(month! + 1).padStart(2, "0")}-01`;
    const { data, error } = await this.client
      .from("x_feed_post_runs")
      .select("cost_usd")
      .gte("operating_date", monthStart)
      .lt("operating_date", nextMonth);
    if (error) throw new Error(`getMonthSpendUsd failed: ${error.message}`);
    return ((data ?? []) as Array<{ cost_usd: number | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
  }

  async listRecentRuns(sinceOperatingDate: string): Promise<XFeedPostRun[]> {
    const { data, error } = await this.client
      .from("x_feed_post_runs")
      .select()
      .gte("operating_date", sinceOperatingDate)
      .order("operating_date", { ascending: false });
    if (error) throw new Error(`listRecentRuns failed: ${error.message}`);
    return ((data ?? []) as Array<Record<string, any>>).map(fromRow);
  }

  async markPosted(operatingDate: string, postedAt: string, postedText: string): Promise<void> {
    const { error } = await this.client
      .from("x_feed_post_runs")
      .update({ posted_at: postedAt, posted_text: postedText, updated_at: new Date().toISOString() })
      .eq("operating_date", operatingDate);
    if (error) throw new Error(`markPosted failed: ${error.message}`);
  }
}
