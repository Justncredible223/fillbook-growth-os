import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { requireAppAuth } from "../src/lib/requireAppAuth";

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
