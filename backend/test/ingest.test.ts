import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const recordConversionEvent = vi.fn().mockResolvedValue({ inserted: true });
vi.mock("../src/attribution/conversionEvents.js", () => ({
  recordConversionEvent,
  CONVERSION_EVENT_TYPES: ["signup", "activation", "first_trade", "first_paid"],
}));
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

  // daily-pipeline.ts DOES now import YouTube- AND TikTok-related modules
  // (2026-09-22) -- real, narrow, deliberate reversals, same posture as
  // growth-pulse.ts's own YouTube comment-monitoring import below: this is
  // automated DRAFTING of already-rendered videos (YouTube as a private,
  // not-publicly-reachable upload; TikTok as an inbox draft the owner
  // still has to post themselves in-app -- both EXTERNAL_DRAFT under
  // externalWriteFirewall.ts, never an autonomous publish) + pulling
  // YouTube's real analytics back (src/video/youtubePublishJob.ts,
  // src/video/youtubeAnalyticsRefresh.ts, src/video/tiktokPublishJob.ts),
  // gated behind YOUTUBE_PUBLISHING_ENABLED/TIKTOK_PUBLISHING_ENABLED, not
  // the old topic/content-scraping ingestion this describe block's title
  // refers to as removed -- that ingestion path (api/ingest.ts's manual
  // source list, asserted above) is untouched.
  it("daily-pipeline.ts imports YouTube publishing/analytics modules and TikTok publishing modules", () => {
    const source = readFileSync(join(here, "..", "api", "daily-pipeline.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));
    expect(imports.some((line) => /youtubePublishJob|youtubeAnalyticsRefresh/i.test(line))).toBe(true);
    expect(imports.some((line) => /tiktokPublishJob/i.test(line))).toBe(true);
  });

  // growth-pulse.ts DOES now import YouTube-related modules (2026-09-18) --
  // a real reversal, but a narrow, deliberate one: it's comment monitoring
  // on the owner's OWN already-posted videos (a poll target the owner
  // explicitly records via Video Status's "posted URL" field, see
  // setPublishedUrl), not the old topic/content-scraping ingestion this
  // whole describe block's title refers to as removed. TikTok gets none of
  // this -- its comment API is research-access-only, excludes commercial
  // use entirely (confirmed 2026-09-18), so growth-pulse.ts has no TikTok
  // import at all, only YouTube.
  it("growth-pulse.ts imports YouTube comment-monitoring modules, but still no TikTok import at all", () => {
    const source = readFileSync(join(here, "..", "api", "growth-pulse.ts"), "utf8");
    const imports = source.split("\n").filter((line) => line.startsWith("import "));
    expect(imports.some((line) => /youtubeAdapter|youtubeUrl/i.test(line))).toBe(true);
    expect(imports.some((line) => /tiktok/i.test(line))).toBe(false);
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

  // Growth loop (2026-09-18): the funnel extension -- event_type,
  // external_event_id (dedup key), subject_hash (pseudonymous per-user
  // correlation), and event-touch UTM distinct from signup-touch UTM.
  it("defaults event_type to 'signup' for a body that predates this extension (backward compatible)", async () => {
    const res = mockRes();
    await handler(
      { method: "POST", headers: { authorization: "Bearer webhook-secret" }, query: { source: "fillbook_signup" }, body: { utm_source: "x" } } as any,
      res,
    );
    expect(recordConversionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "signup" }));
  });

  it("rejects an unrecognized event_type by falling back to 'signup' rather than passing through an arbitrary string", async () => {
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer webhook-secret" },
        query: { source: "fillbook_signup" },
        body: { event_type: "not_a_real_stage" },
      } as any,
      res,
    );
    expect(recordConversionEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "signup" }));
  });

  it("passes through event_type, external_event_id, subject_hash, and event-touch UTM", async () => {
    const res = mockRes();
    await handler(
      {
        method: "POST",
        headers: { authorization: "Bearer webhook-secret" },
        query: { source: "fillbook_signup" },
        body: {
          event_type: "first_paid",
          external_event_id: "evt_abc123",
          subject_hash: "a1b2c3",
          event_touch_utm_source: "newsletter",
          event_touch_utm_campaign: "spring_promo",
        },
      } as any,
      res,
    );
    expect(recordConversionEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "first_paid",
        externalEventId: "evt_abc123",
        subjectHash: "a1b2c3",
        eventTouchUtmSource: "newsletter",
        eventTouchUtmCampaign: "spring_promo",
      }),
    );
  });

  it("returns inserted:false transparently when recordConversionEvent reports a duplicate", async () => {
    recordConversionEvent.mockResolvedValueOnce({ inserted: false });
    const res = mockRes();
    await handler(
      { method: "POST", headers: { authorization: "Bearer webhook-secret" }, query: { source: "fillbook_signup" }, body: { external_event_id: "evt_dup" } } as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ recorded: true, inserted: false });
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
