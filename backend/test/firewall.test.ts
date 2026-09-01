import { describe, it, expect, vi } from "vitest";
import {
  authorize,
  authorizeAndAudit,
  ExternalWriteRejectedError,
  KNOWN_EXTERNAL_WRITE_ACTIONS,
  type ActionClass,
  type FirewallAction,
} from "../src/firewall/externalWriteFirewall";

describe("ExternalWriteFirewall", () => {
  it("rejects every known EXTERNAL_WRITE action", () => {
    for (const name of KNOWN_EXTERNAL_WRITE_ACTIONS) {
      expect(() => authorize({ name, actionClass: "EXTERNAL_WRITE" })).toThrow(
        ExternalWriteRejectedError,
      );
    }
  });

  it("rejects EXTERNAL_WRITE even with attempted override-like context fields", () => {
    // These context keys are meaningless to the firewall by design — there
    // is no field anywhere that flips the outcome. This test exists to
    // prove that, not to imply such fields do anything.
    const attemptedOverrides: Record<string, unknown>[] = [
      { forcePublish: true },
      { autopilot: true },
      { adminOverride: true },
      { ownerApproved: true },
      { bypassFirewall: true },
    ];
    for (const context of attemptedOverrides) {
      expect(() =>
        authorize({ name: "x.post_tweet", actionClass: "EXTERNAL_WRITE", context }),
      ).toThrow(ExternalWriteRejectedError);
    }
  });

  it("allows READ", () => {
    expect(() =>
      authorize({ name: "search_console.read_queries", actionClass: "READ" }),
    ).not.toThrow();
  });

  it("allows INTERNAL_WRITE", () => {
    expect(() =>
      authorize({ name: "opportunities.save_score", actionClass: "INTERNAL_WRITE" }),
    ).not.toThrow();
  });

  it("allows EXTERNAL_DRAFT", () => {
    expect(() =>
      authorize({ name: "tiktok.open_composer_with_draft", actionClass: "EXTERNAL_DRAFT" }),
    ).not.toThrow();
  });

  it("audits a rejected EXTERNAL_WRITE attempt", async () => {
    const auditSink = vi.fn();
    await expect(
      authorizeAndAudit(
        { name: "x.post_tweet", actionClass: "EXTERNAL_WRITE", context: { text: "hello" } },
        auditSink,
      ),
    ).rejects.toThrow(ExternalWriteRejectedError);

    expect(auditSink).toHaveBeenCalledTimes(1);
    const record = auditSink.mock.calls[0]![0];
    expect(record.outcome).toBe("rejected");
    expect(record.actionClass).toBe("EXTERNAL_WRITE");
    expect(record.actionName).toBe("x.post_tweet");
  });

  it("audits an allowed READ and an allowed/drafted EXTERNAL_DRAFT distinctly", async () => {
    const auditSink = vi.fn();

    await authorizeAndAudit({ name: "search_console.read_queries", actionClass: "READ" }, auditSink);
    await authorizeAndAudit(
      { name: "tiktok.open_composer_with_draft", actionClass: "EXTERNAL_DRAFT" },
      auditSink,
    );

    expect(auditSink).toHaveBeenCalledTimes(2);
    expect(auditSink.mock.calls[0]![0].outcome).toBe("allowed");
    expect(auditSink.mock.calls[1]![0].outcome).toBe("drafted");
  });

  it("has no code path that accepts an override flag for EXTERNAL_WRITE", () => {
    // authorize()'s signature only accepts a FirewallAction — there is no
    // second parameter to pass an override through. This test documents
    // the invariant at the type level: calling with an extra property
    // does not change behavior.
    function authorizeWithExtraField(): FirewallAction {
      return authorize({
        name: "x.post_tweet",
        actionClass: "EXTERNAL_WRITE" as ActionClass,
        context: {},
        // @ts-expect-error -- no such field exists; if this ever compiles, the invariant broke.
        forceAllow: true,
      });
    }
    expect(() => authorizeWithExtraField()).toThrow(ExternalWriteRejectedError);
  });
});
