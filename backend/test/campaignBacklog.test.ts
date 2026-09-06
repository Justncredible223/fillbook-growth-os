import { describe, it, expect } from "vitest";
import { isReviewableBacklogAsset, countReviewableBacklog, resolveBacklogRepairStage } from "../src/content/campaignBacklog";

/**
 * Regression coverage for a real, confirmed bug: the auto-draft backlog
 * cap counted every campaign_assets row at stage='ready_for_owner'
 * regardless of its campaign's status, while the Approvals screen only
 * ever surfaces campaigns still 'in_review' -- so an already-approved or
 * -rejected asset (or a Partnership pitch, whose campaign stays 'draft'
 * by design) kept inflating the cap forever with no way to see or clear
 * it. See campaignBacklog.ts's own kdoc.
 */
describe("isReviewableBacklogAsset", () => {
  it("counts a genuinely still-reviewable asset -- ready_for_owner + in_review", () => {
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: "in_review" })).toBe(true);
  });

  it("does NOT count an already-approved asset", () => {
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: "approved" })).toBe(false);
  });

  it("does NOT count an already-retired (rejected) asset", () => {
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: "retired" })).toBe(false);
  });

  it("does NOT count a Partnership pitch's campaign -- stays 'draft' by design, awaiting its own Partnerships-tab workflow", () => {
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: "draft" })).toBe(false);
  });

  it("does NOT count a row with no campaign status at all", () => {
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: null })).toBe(false);
    expect(isReviewableBacklogAsset({ stage: "ready_for_owner", campaignStatus: undefined })).toBe(false);
  });

  it("does NOT count a row that isn't even at ready_for_owner, regardless of campaign status", () => {
    expect(isReviewableBacklogAsset({ stage: "handed_off", campaignStatus: "in_review" })).toBe(false);
    expect(isReviewableBacklogAsset({ stage: "draft", campaignStatus: "in_review" })).toBe(false);
  });
});

describe("countReviewableBacklog", () => {
  it("counts only the genuinely reviewable rows out of a mixed set -- the exact 4-row scenario this bug was found against", () => {
    const rows = [
      { stage: "ready_for_owner", campaignStatus: "approved" }, // already approved -- stuck by the bug
      { stage: "ready_for_owner", campaignStatus: "approved" }, // already approved -- stuck by the bug
      { stage: "ready_for_owner", campaignStatus: "draft" }, // Partnership pitch, not yet reviewed
      { stage: "ready_for_owner", campaignStatus: "draft" }, // Partnership pitch, not yet reviewed
    ];
    expect(countReviewableBacklog(rows)).toBe(0);
  });

  it("counts a genuine mix correctly", () => {
    const rows = [
      { stage: "ready_for_owner", campaignStatus: "in_review" },
      { stage: "ready_for_owner", campaignStatus: "in_review" },
      { stage: "ready_for_owner", campaignStatus: "approved" },
      { stage: "ready_for_owner", campaignStatus: "draft" },
    ];
    expect(countReviewableBacklog(rows)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(countReviewableBacklog([])).toBe(0);
  });
});

describe("resolveBacklogRepairStage", () => {
  it("repairs a stuck approved asset to handed_off", () => {
    expect(resolveBacklogRepairStage("ready_for_owner", "approved")).toBe("handed_off");
  });

  it("repairs a stuck retired (rejected) asset to retired", () => {
    expect(resolveBacklogRepairStage("ready_for_owner", "retired")).toBe("retired");
  });

  it("never repairs a Partnership pitch's campaign (draft) -- would incorrectly auto-approve/hide an unreviewed pitch", () => {
    expect(resolveBacklogRepairStage("ready_for_owner", "draft")).toBeNull();
  });

  it("never repairs a genuinely still-reviewable asset (in_review)", () => {
    expect(resolveBacklogRepairStage("ready_for_owner", "in_review")).toBeNull();
  });

  it("never touches a row that isn't at ready_for_owner in the first place", () => {
    expect(resolveBacklogRepairStage("handed_off", "approved")).toBeNull();
    expect(resolveBacklogRepairStage("draft", "approved")).toBeNull();
  });

  it("repeated repair is safe -- running it again on an already-repaired row (now handed_off, not ready_for_owner) is a no-op", () => {
    const firstPass = resolveBacklogRepairStage("ready_for_owner", "approved");
    expect(firstPass).toBe("handed_off");
    // Simulate the row after the first repair: stage is now firstPass's value.
    const secondPass = resolveBacklogRepairStage(firstPass!, "approved");
    expect(secondPass).toBeNull();
  });
});
