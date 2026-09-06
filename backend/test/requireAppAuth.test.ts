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
