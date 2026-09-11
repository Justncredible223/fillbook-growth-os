import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const recordConversionEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/attribution/conversionEvents.js", () => ({ recordConversionEvent }));
// The redirect path's own recordLinkClick call is left un-mocked and will
// throw against this fake client -- intentional, since the redirect
// handler's whole point is that a logging failure must never block the
// redirect (see its doc comment in api/ingest.ts).
vi.mock("../src/lib/supabaseClient.js", () => ({ getServiceClient: () => ({}) }));

const handlerModule = await import("../api/ingest");
const handler = handlerModule.default;
const { MANUAL_INGEST_SOURCES, isManualIngestSource } = handlerModule;

const here = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
}

describe("api/ingest -- YouTube/TikTok removed, X + Search Console remain manual-only", () => {
  const originalToken = process.env.APP_API_TOKEN;

  beforeEach(() => {
    process.env.APP_API_TOKEN = "test-token";
  });
  afterEach(() => {
    process.env.APP_API_TOKEN = originalToken;
  });

  it("the manual source list is exactly x, search_console, and x_prospecting", () => {
    expect([...MANUAL_INGEST_SOURCES]).toEqual(["x", "search_console", "x_prospecting"]);
    expect(isManualIngestSource("youtube")).toBe(false);
    expect(isManualIngestSource("tiktok")).toBe(false);
    expect(isManualIngestSource("x")).toBe(true);
    expect(isManualIngestSource("x_prospecting")).toBe(true);
  });

  for (const removed of ["youtube", "tiktok"]) {
    it(`rejects source=${removed} with 400 before touching any client`, async () => {
      const res = mockRes();
      await handler({ method: "POST", headers: { authorization: "Bearer test-token" }, query: { source: removed } } as any, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: "Query param 'source' must be one of: x, search_console, x_prospecting" });
    });
  }

  it("the scheduled entry points contain no path to YouTube/TikTok ingestion", () => {
    for (const file of ["daily-pipeline.ts", "growth-pulse.ts"]) {
      const source = readFileSync(join(here, "..", "api", file), "utf8");
      const imports = source.split("\n").filter((line) => line.startsWith("import "));
      expect(imports.some((line) => /youtube|tiktok/i.test(line))).toBe(false);
    }
  });
});

describe("api/ingest?source=fillbook_signup -- webhook from FillbookHQ's signup flow", () => {
  const originalSecret = process.env.FILLBOOK_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.FILLBOOK_WEBHOOK_SECRET = "webhook-secret";
    recordConversionEvent.mockClear();
  });
  afterEach(() => {
    process.env.FILLBOOK_WEBHOOK_SECRET = originalSecret;
  });

  it("rejects a request with no/wrong Authorization header, without calling requireAppAuth's APP_API_TOKEN check", async () => {
    const res = mockRes();
    await handler({ method: "POST", headers: {}, query: { source: "fillbook_signup" }, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(recordConversionEvent).not.toHaveBeenCalled();
  });

  it("500s with a clear message when FILLBOOK_WEBHOOK_SECRET isn't configured", async () => {
    delete process.env.FILLBOOK_WEBHOOK_SECRET;
    const res = mockRes();
    await handler({ method: "POST", headers: { authorization: "Bearer anything" }, query: { source: "fillbook_signup" }, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("records a conversion event from a correctly-authorized signup webhook", async () => {
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer webhook-secret" },
        query: { source: "fillbook_signup" },
        body: { utm_source: "x", utm_medium: "social", utm_campaign: "camp1", utm_content: "asset1", referral_code: "AB12CD", occurred_at: "2026-09-10T00:00:00.000Z" },
      } as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(recordConversionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "fillbook_signup", utmSource: "x", utmCampaign: "camp1", referralCode: "AB12CD" }),
    );
  });

  it("rejects a non-POST method", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: { authorization: "Bearer webhook-secret" }, query: { source: "fillbook_signup" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe("api/ingest?source=click -- public short-link redirect", () => {
  it("redirects to an allowlisted fillbookhq.com target", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: { source: "click", key: "reply-123", to: "https://fillbookhq.com/pricing" } } as any, res);
    expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "https://fillbookhq.com/pricing" });
  });

  it("rejects a target host outside the allowlist -- never becomes an open redirect", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: { source: "click", key: "reply-123", to: "https://evil.example.com/phish" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it("rejects a missing key or to param", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: { source: "click", to: "https://fillbookhq.com/" } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("requires no Authorization header at all", async () => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: { source: "click", key: "k", to: "https://fillbookhq.com/" } } as any, res);
    expect(res.status).not.toHaveBeenCalledWith(401);
  });
});
