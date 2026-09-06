import { describe, it, expect, vi } from "vitest";
import { CampaignFactory, resolveOwnerDecisionStage, applyOwnerDecisionIfPending } from "../src/content/campaignFactory";
import { ContentQualityGate } from "../src/content/contentQualityGate";
import { BrandConstitution } from "../src/knowledge/brandConstitution";
import { InMemoryBrandConstitutionRepository } from "../src/knowledge/inMemoryRepositories";
import type { BrandRule } from "../src/knowledge/types";
import { LlmClient } from "../src/content/llmClient";
import { InMemoryContentScoreRepository } from "../src/content/contentScoreRepository";

const rules: BrandRule[] = [
  {
    id: "r1",
    version: 1,
    ruleType: "claim_prohibited",
    content:
      "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.",
    sourceDoc: null,
    isActive: true,
  },
];

function buildFactory(auditSink = vi.fn()) {
  const gate = new ContentQualityGate(new BrandConstitution(new InMemoryBrandConstitutionRepository(rules)));
  return { factory: new CampaignFactory(gate, auditSink), auditSink };
}

describe("CampaignFactory", () => {
  it("advances clean content to final_draft", async () => {
    const { factory } = buildFactory();
    const result = await factory.submitDraft(
      "draft",
      "Most funded accounts get pulled for violating a rule nobody reads twice.",
      [],
    );
    expect(result.advanced).toBe(true);
    expect(result.newStage).toBe("final_draft");
  });

  it("blocks content that fails the quality gate and keeps it at the current stage", async () => {
    const { factory } = buildFactory();
    const result = await factory.submitDraft("draft", "When I traded NQ today I caught a great move.", []);
    expect(result.advanced).toBe(false);
    expect(result.newStage).toBe("draft");
    expect(result.blockReasons.length).toBeGreaterThan(0);
  });

  it("refuses to mark ready_for_owner from any stage except final_draft", () => {
    const { factory } = buildFactory();
    expect(() => factory.markReadyForOwner("draft")).toThrow();
    expect(factory.markReadyForOwner("final_draft")).toBe("ready_for_owner");
  });

  it("hands off to the owner as EXTERNAL_DRAFT and audits it, never as EXTERNAL_WRITE", async () => {
    const { factory, auditSink } = buildFactory();
    const stage = await factory.handOffToOwner("ready_for_owner", "tiktok", "asset-1");
    expect(stage).toBe("handed_off");
    expect(auditSink).toHaveBeenCalledTimes(1);
    const record = auditSink.mock.calls[0]![0];
    expect(record.actionClass).toBe("EXTERNAL_DRAFT");
    expect(record.outcome).toBe("drafted");
  });

  it("refuses to hand off before the asset is ready_for_owner", async () => {
    const { factory } = buildFactory();
    await expect(factory.handOffToOwner("final_draft", "x", "asset-2")).rejects.toThrow();
  });

  it("has no public API surface that lets a caller request EXTERNAL_WRITE", () => {
    const { factory } = buildFactory();
    // handOffToOwner's signature has no actionClass parameter at all —
    // there is nothing to pass to make it publish instead of draft.
    expect(factory.handOffToOwner.length).toBe(3); // (currentStage, platform, assetId)
  });

  it("runAndRecordDeepReview persists every verdict regardless of pass/fail", async () => {
    const { factory } = buildFactory();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [{ type: "tool_use", name: "submit_verdict", input: { pass: true, score: 1, reasoning: "solid hook", issues: [] } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            { type: "tool_use", name: "submit_verdict", input: { pass: false, score: 0.1, reasoning: "wrong tick math", issues: ["fix contract size"] } },
          ],
        }),
      });
    const client = new LlmClient("test-key", fetchMock);
    const scoreRepo = new InMemoryContentScoreRepository();
    const context = { platform: "X", brandRulesSummary: "", verifiedKnowledgeSummary: "" };

    const result = await factory.runAndRecordDeepReview(
      client,
      scoreRepo,
      "content-version-1",
      "some draft text",
      context,
      ["hook_specialist", "trader"],
    );

    expect(result.passed).toBe(false);
    expect(scoreRepo.saved).toHaveLength(2);
    expect(scoreRepo.saved[0]).toEqual({
      contentVersionId: "content-version-1",
      verdict: { agent: "hook_specialist", pass: true, score: 1, reasoning: "solid hook", issues: [] },
    });
    expect(scoreRepo.saved[1]!.verdict.pass).toBe(false);
  });
});

/**
 * Regression coverage for a real, confirmed bug: Approve/Reject in the
 * Approvals screen only ever updated campaigns.status, never this
 * asset's own stage -- an already-decided asset stayed at
 * 'ready_for_owner' forever, permanently (and incorrectly) counted by
 * the backlog cap. See api/approvals.ts's own kdoc for the live wiring,
 * and campaignBacklog.ts for the backlog-count side of this same fix.
 */
describe("resolveOwnerDecisionStage", () => {
  it("approve transitions ready_for_owner to handed_off", () => {
    expect(resolveOwnerDecisionStage("ready_for_owner", "approved")).toBe("handed_off");
  });

  it("reject transitions ready_for_owner to retired", () => {
    expect(resolveOwnerDecisionStage("ready_for_owner", "rejected")).toBe("retired");
  });

  it("refuses to resolve a decision from any stage except ready_for_owner", () => {
    expect(() => resolveOwnerDecisionStage("final_draft", "approved")).toThrow();
    expect(() => resolveOwnerDecisionStage("handed_off", "approved")).toThrow();
    expect(() => resolveOwnerDecisionStage("retired", "rejected")).toThrow();
  });
});

describe("applyOwnerDecisionIfPending", () => {
  it("behaves exactly like resolveOwnerDecisionStage when the asset is genuinely pending", () => {
    expect(applyOwnerDecisionIfPending("ready_for_owner", "approved")).toBe("handed_off");
    expect(applyOwnerDecisionIfPending("ready_for_owner", "rejected")).toBe("retired");
  });

  it("a reviewable asset can never be left permanently stuck: every real decision call resolves it off ready_for_owner", () => {
    expect(applyOwnerDecisionIfPending("ready_for_owner", "approved")).not.toBe("ready_for_owner");
    expect(applyOwnerDecisionIfPending("ready_for_owner", "rejected")).not.toBe("ready_for_owner");
  });

  it("a repeated Approve/Reject call (double-tap, retry, or a race with an already-processed decision) is a safe no-op, never a throw", () => {
    expect(() => applyOwnerDecisionIfPending("handed_off", "approved")).not.toThrow();
    expect(applyOwnerDecisionIfPending("handed_off", "approved")).toBeNull();
    expect(applyOwnerDecisionIfPending("retired", "rejected")).toBeNull();
  });
});
