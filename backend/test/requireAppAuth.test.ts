import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { constantTimeEquals, requireAppAuth } from "../src/lib/requireAppAuth";

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAppAuth", () => {
  const originalToken = process.env.APP_API_TOKEN;

  beforeEach(() => {
    process.env.APP_API_TOKEN = "test-secret-token-12345";
  });

  afterEach(() => {
    process.env.APP_API_TOKEN = originalToken;
  });

  it("rejects with 500 when APP_API_TOKEN isn't configured", () => {
    delete process.env.APP_API_TOKEN;
    const res = mockRes();
    const result = requireAppAuth({ headers: {} } as any, res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("rejects a missing Authorization header", () => {
    const res = mockRes();
    const result = requireAppAuth({ headers: {} } as any, res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a wrong token", () => {
    const res = mockRes();
    const result = requireAppAuth({ headers: { authorization: "Bearer wrong-token" } } as any, res);
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a token that differs only in length", () => {
    const res = mockRes();
    const result = requireAppAuth({ headers: { authorization: "Bearer test-secret-token-1234" } } as any, res);
    expect(result).toBe(false);
  });

  it("accepts the correct token", () => {
    const res = mockRes();
    const result = requireAppAuth({ headers: { authorization: "Bearer test-secret-token-12345" } } as any, res);
    expect(result).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("is case-sensitive and exact -- a near-miss with different casing fails", () => {
    const res = mockRes();
    const result = requireAppAuth({ headers: { authorization: "bearer test-secret-token-12345" } } as any, res);
    expect(result).toBe(false);
  });
});

/**
 * Regression coverage for APP_API_TOKEN_PREVIOUS -- added to support a
 * rotation window where the server accepts both the new and the outgoing
 * token so an owner's device running whichever APK build isn't locked out
 * mid-rotation. See requireAppAuth.ts's own doc comment for the full
 * rationale.
 */
describe("requireAppAuth -- APP_API_TOKEN_PREVIOUS rotation window", () => {
  const originalToken = process.env.APP_API_TOKEN;
  const originalPrevious = process.env.APP_API_TOKEN_PREVIOUS;

  beforeEach(() => {
    process.env.APP_API_TOKEN = "current-token-abc";
  });

  afterEach(() => {
    process.env.APP_API_TOKEN = originalToken;
    process.env.APP_API_TOKEN_PREVIOUS = originalPrevious;
  });

  it("accepts the current token when APP_API_TOKEN_PREVIOUS is unset -- unset is a normal state, not an error", () => {
    delete process.env.APP_API_TOKEN_PREVIOUS;
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer current-token-abc" } } as any, res);

    expect(result).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("accepts the current token when APP_API_TOKEN_PREVIOUS is also set", () => {
    process.env.APP_API_TOKEN_PREVIOUS = "previous-token-xyz";
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer current-token-abc" } } as any, res);

    expect(result).toBe(true);
  });

  it("accepts the previous token during a rotation window", () => {
    process.env.APP_API_TOKEN_PREVIOUS = "previous-token-xyz";
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer previous-token-xyz" } } as any, res);

    expect(result).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a wrong token even when a previous token is configured", () => {
    process.env.APP_API_TOKEN_PREVIOUS = "previous-token-xyz";
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer some-other-token" } } as any, res);

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects the previous token once APP_API_TOKEN_PREVIOUS is unset again -- rotation window closed", () => {
    delete process.env.APP_API_TOKEN_PREVIOUS;
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer previous-token-xyz" } } as any, res);

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a missing Authorization header even mid-rotation", () => {
    process.env.APP_API_TOKEN_PREVIOUS = "previous-token-xyz";
    const res = mockRes();

    const result = requireAppAuth({ headers: {} } as any, res);

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("still rejects with 500 when APP_API_TOKEN itself isn't configured, regardless of APP_API_TOKEN_PREVIOUS", () => {
    delete process.env.APP_API_TOKEN;
    process.env.APP_API_TOKEN_PREVIOUS = "previous-token-xyz";
    const res = mockRes();

    const result = requireAppAuth({ headers: { authorization: "Bearer previous-token-xyz" } } as any, res);

    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

/**
 * constantTimeEquals is now exported (production-readiness audit finding)
 * so the CRON_SECRET checks in daily-pipeline.ts and growth-pulse.ts can
 * reuse the same timing-safe comparison requireAppAuth already used for
 * APP_API_TOKEN, instead of each cron endpoint's own plain `!==`.
 */
describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("Bearer abc123", "Bearer abc123")).toBe(true);
  });

  it("returns false for a different value of the same length", () => {
    expect(constantTimeEquals("Bearer abc123", "Bearer abc124")).toBe(false);
  });

  it("returns false for a different length -- never throws on the length mismatch", () => {
    expect(constantTimeEquals("Bearer abc123", "Bearer abc12")).toBe(false);
    expect(constantTimeEquals("short", "a much longer string")).toBe(false);
  });

  it("returns false against an empty string", () => {
    expect(constantTimeEquals("Bearer abc123", "")).toBe(false);
  });
});

/**
 * APP_API_TOKEN_AUTOMATION: a second, separately rotated credential for scripts and assistants. It must only ever open
 * the endpoints that opt in (requesting a video, reading status), never the ones that approve, reject or edit.
 */
describe("requireAppAuth -- APP_API_TOKEN_AUTOMATION", () => {
  const AUTOMATION = "automation-token-0123456789-abcdefghijklmnop";
  const saved = { t: process.env.APP_API_TOKEN, p: process.env.APP_API_TOKEN_PREVIOUS, a: process.env.APP_API_TOKEN_AUTOMATION };

  beforeEach(() => {
    process.env.APP_API_TOKEN = "current-token-abc";
    delete process.env.APP_API_TOKEN_PREVIOUS;
    process.env.APP_API_TOKEN_AUTOMATION = AUTOMATION;
  });

  afterEach(() => {
    for (const [key, value] of [["APP_API_TOKEN", saved.t], ["APP_API_TOKEN_PREVIOUS", saved.p], ["APP_API_TOKEN_AUTOMATION", saved.a]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const call = (token: string, options?: { allowAutomation?: boolean }) => {
    const res = mockRes();
    const ok = requireAppAuth({ headers: { authorization: `Bearer ${token}` } } as any, res, options);
    return { ok, res };
  };

  it("accepts the automation token on an endpoint that opted in", () => {
    expect(call(AUTOMATION, { allowAutomation: true }).ok).toBe(true);
  });

  it("refuses the automation token on an endpoint that did not opt in, so it can never approve or reject", () => {
    const { ok, res } = call(AUTOMATION);
    expect(ok).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(call(AUTOMATION, { allowAutomation: false }).ok).toBe(false);
  });

  it("treats a too-short automation token as not configured", () => {
    process.env.APP_API_TOKEN_AUTOMATION = "short";
    expect(call("short", { allowAutomation: true }).ok).toBe(false);
  });

  it("is a normal state when no automation token is set: nothing changes for the app's own token", () => {
    delete process.env.APP_API_TOKEN_AUTOMATION;
    expect(call("current-token-abc", { allowAutomation: true }).ok).toBe(true);
    expect(call("", { allowAutomation: true }).ok).toBe(false);
    expect(call("anything", { allowAutomation: true }).ok).toBe(false);
  });

  it("still accepts the app's own token on every endpoint, opted in or not", () => {
    expect(call("current-token-abc").ok).toBe(true);
    expect(call("current-token-abc", { allowAutomation: true }).ok).toBe(true);
  });

  it("rejects a wrong token even when an automation token is configured", () => {
    expect(call("some-other-token-that-is-long-enough-12345", { allowAutomation: true }).ok).toBe(false);
  });
});

describe("approvals endpoint -- the automation token opens only the read-only video-status list", () => {
  const AUTOMATION = "automation-token-0123456789-abcdefghijklmnop";
  const saved = { t: process.env.APP_API_TOKEN, a: process.env.APP_API_TOKEN_AUTOMATION };

  beforeEach(() => {
    process.env.APP_API_TOKEN = "current-token-abc";
    process.env.APP_API_TOKEN_AUTOMATION = AUTOMATION;
  });

  afterEach(() => {
    if (saved.t === undefined) delete process.env.APP_API_TOKEN;
    else process.env.APP_API_TOKEN = saved.t;
    if (saved.a === undefined) delete process.env.APP_API_TOKEN_AUTOMATION;
    else process.env.APP_API_TOKEN_AUTOMATION = saved.a;
  });

  async function hit(method: string, query: Record<string, string>) {
    const { default: handler } = await import("../api/approvals");
    const res = mockRes();
    res.setHeader = vi.fn();
    res.end = vi.fn();
    try {
      await handler({ method, query, headers: { authorization: `Bearer ${AUTOMATION}` }, body: {} } as any, res);
    } catch {
      // Past the auth gate the handler needs a database; this test only cares whether the gate let it through.
    }
    return res;
  }

  it("lets the automation token read video-status (GET)", async () => {
    const res = await hit("GET", { resource: "video-status" });
    expect(res.status).not.toHaveBeenCalledWith(401);
  });

  it("refuses it on video-status with any other method", async () => {
    const res = await hit("POST", { resource: "video-status" });
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("refuses it on the approvals queue itself, and on every other resource", async () => {
    for (const query of [{} as Record<string, string>, { resource: "inbound" }, { resource: "prospecting" }, { resource: "partnerships" }, { resource: "posting" }]) {
      for (const method of ["GET", "POST", "PATCH"]) {
        const res = await hit(method, query);
        expect(res.status, `${method} ${JSON.stringify(query)}`).toHaveBeenCalledWith(401);
      }
    }
  });
});
