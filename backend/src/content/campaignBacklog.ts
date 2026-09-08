/**
 * The single definition of "this campaign_assets row is part of the
 * owner's reviewable backlog" -- used identically by the Approvals
 * screen's own list (api/approvals.ts) and the auto-draft backlog cap
 * (api/daily-pipeline.ts). Before this existed, the backlog cap counted
 * every row at stage='ready_for_owner' regardless of its campaign's
 * status, while the Approvals list only ever showed campaigns still
 * 'in_review' -- so an already-approved or -rejected asset (or a
 * Partnership pitch's campaign, which stays 'draft' by design, awaiting
 * its own Partnerships-tab workflow, not this one) kept counting toward
 * the cap forever with no way to see or clear it. This one predicate is
 * now the only place that decision is made.
 */
export interface BacklogCandidateRow {
  stage: string;
  campaignStatus: string | null | undefined;
}

/** True iff this row genuinely still awaits an owner decision here -- ready_for_owner AND its campaign is still in_review. False for draft (not yet AI-reviewed, or a Partnership pitch's own campaign, which never leaves draft), approved, retired, or any other campaigns.status. */
export function isReviewableBacklogAsset(row: BacklogCandidateRow): boolean {
  return row.stage === "ready_for_owner" && row.campaignStatus === "in_review";
}

/** Counts how many of the given rows are genuinely part of the owner's reviewable backlog -- see isReviewableBacklogAsset. */
export function countReviewableBacklog(rows: BacklogCandidateRow[]): number {
  return rows.filter(isReviewableBacklogAsset).length;
}

/**
 * What a one-time backlog repair should set campaign_assets.stage to for
 * an existing stuck row, or null if this row needs no repair. Mirrors
 * migration 0030's idempotent UPDATE statements exactly (kept here as a
 * pure, unit-testable model of that SQL's WHERE/SET logic) -- pure
 * function, no I/O, so its idempotency (running it again on an
 * already-repaired row is a no-op) and its Partnership-safety (a 'draft'
 * campaign status is never touched) are both directly testable.
 */
export function resolveBacklogRepairStage(stage: string, campaignStatus: string | null | undefined): "handed_off" | "retired" | null {
  if (stage !== "ready_for_owner") return null;
  if (campaignStatus === "approved") return "handed_off";
  if (campaignStatus === "retired") return "retired";
  return null; // 'draft' (e.g. a Partnership pitch awaiting its own workflow) or 'in_review' (genuinely still reviewable) -- never repaired.
}
