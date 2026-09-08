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
