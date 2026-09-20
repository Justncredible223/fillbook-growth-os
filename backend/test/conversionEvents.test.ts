import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { recordConversionEvent } from "../src/attribution/conversionEvents";

const BASE = {
  source: "fillbook_signup",
  utmSource: "x",
  utmMedium: "organic_social",
  utmCampaign: "camp1",
  utmContent: "asset1",
  referralCode: null,
  occurredAt: "2026-09-18T00:00:00.000Z",
};

describe("recordConversionEvent", () => {
  it("defaults eventType to 'signup' and passes through null optional fields", async () => {
    const client = new FakeSupabaseClient({ conversion_events: [] });
    const result = await recordConversionEvent(asSupabase(client), BASE);
    expect(result).toEqual({ inserted: true });
    const insertLog = client.queriesFor("conversion_events").find((q) => q.op === "insert");
    expect(insertLog?.payload).toMatchObject({
      event_type: "signup",
      external_event_id: null,
      subject_hash: null,
      utm_source: "x",
    });
  });

  it("passes through event_type, external_event_id, subject_hash, and event-touch UTM", async () => {
    const client = new FakeSupabaseClient({ conversion_events: [] });
    await recordConversionEvent(asSupabase(client), {
      ...BASE,
      eventType: "first_paid",
      externalEventId: "evt-123",
      subjectHash: "abc123hash",
      eventTouchUtmSource: "newsletter",
      eventTouchUtmCampaign: "spring",
    });
    const insertLog = client.queriesFor("conversion_events").find((q) => q.op === "insert");
    expect(insertLog?.payload).toMatchObject({
      event_type: "first_paid",
      external_event_id: "evt-123",
      subject_hash: "abc123hash",
      event_touch_utm_source: "newsletter",
      event_touch_utm_campaign: "spring",
    });
  });

  it("returns inserted:false (not a throw) when the unique(source, external_event_id) constraint rejects a duplicate", async () => {
    const client = new FakeSupabaseClient({ conversion_events: [] });
    client.failTable("conversion_events", { message: "duplicate key value violates unique constraint", code: "23505" }, "insert");
    const result = await recordConversionEvent(asSupabase(client), { ...BASE, externalEventId: "evt-dup" });
    expect(result).toEqual({ inserted: false });
  });

  it("throws on any other database error rather than silently swallowing it", async () => {
    const client = new FakeSupabaseClient({ conversion_events: [] });
    client.failTable("conversion_events", { message: "connection reset", code: "08006" }, "insert");
    await expect(recordConversionEvent(asSupabase(client), BASE)).rejects.toThrow(/connection reset/);
  });
});
