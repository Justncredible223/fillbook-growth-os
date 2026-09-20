import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { recordOwnerPublication, getOrCreateDestinationLink, listPublicationsForAssets } from "../src/attribution/contentPublications";

describe("recordOwnerPublication", () => {
  it("marks evidence_type as owner_reported_url when a real URL is given", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    const row = await recordOwnerPublication(asSupabase(client), {
      campaignAssetId: "asset-1",
      channel: "youtube",
      actualUrl: "https://youtube.com/watch?v=abc12345678",
    });
    expect(row.evidenceType).toBe("owner_reported_url");
    expect(row.actualUrl).toBe("https://youtube.com/watch?v=abc12345678");
  });

  it("marks evidence_type as owner_confirmed_no_url when no URL is given (e.g. a plain X reply)", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    const row = await recordOwnerPublication(asSupabase(client), { campaignAssetId: "asset-1", channel: "x" });
    expect(row.evidenceType).toBe("owner_confirmed_no_url");
    expect(row.actualUrl).toBeNull();
  });

  it("rejects a garbage (non-URL) string rather than saving it", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    await expect(
      recordOwnerPublication(asSupabase(client), { campaignAssetId: "asset-1", channel: "tiktok", actualUrl: "not a url at all" }),
    ).rejects.toThrow(/doesn't look like a real URL/);
  });

  it("rejects a non-http(s) URL scheme", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    await expect(
      recordOwnerPublication(asSupabase(client), { campaignAssetId: "asset-1", channel: "tiktok", actualUrl: "javascript:alert(1)" }),
    ).rejects.toThrow(/http\(s\)/);
  });

  it("treats an empty/whitespace-only URL the same as no URL", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    const row = await recordOwnerPublication(asSupabase(client), { campaignAssetId: "asset-1", channel: "instagram", actualUrl: "   " });
    expect(row.evidenceType).toBe("owner_confirmed_no_url");
  });

  it("upserts on (campaign_asset_id, channel), never a plain insert -- editing an existing link updates in place", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    await recordOwnerPublication(asSupabase(client), { campaignAssetId: "asset-1", channel: "youtube", actualUrl: "https://youtube.com/watch?v=aaaaaaaaaaa" });
    const upsertLog = client.queriesFor("content_publications").find((q) => q.op === "upsert");
    expect(upsertLog).toBeDefined();
  });
});

describe("getOrCreateDestinationLink", () => {
  it("returns the existing destination_link without regenerating it", async () => {
    const client = new FakeSupabaseClient({
      content_publications: [{ campaign_asset_id: "asset-1", channel: "x", destination_link: "https://www.fillbookhq.com/?utm_content=asset-1" }],
    });
    const link = await getOrCreateDestinationLink(asSupabase(client), { campaignAssetId: "asset-1", channel: "x", campaignThesis: "some topic" });
    expect(link).toBe("https://www.fillbookhq.com/?utm_content=asset-1");
    expect(client.queriesFor("content_publications").some((q) => q.op === "upsert")).toBe(false);
  });

  it("generates and persists a new destination link when none exists yet", async () => {
    const client = new FakeSupabaseClient({ content_publications: [] });
    const link = await getOrCreateDestinationLink(asSupabase(client), { campaignAssetId: "asset-2", channel: "youtube", campaignThesis: "trailing drawdown" });
    expect(link).toContain("utm_content=asset-2");
    expect(link.startsWith("https://www.fillbookhq.com/")).toBe(true);
    const upsertLog = client.queriesFor("content_publications").find((q) => q.op === "upsert");
    expect((upsertLog?.payload as any)?.destination_link).toBe(link);
  });
});

describe("listPublicationsForAssets", () => {
  it("returns an empty array for an empty id list without querying", async () => {
    const client = new FakeSupabaseClient({ content_publications: [{ campaign_asset_id: "a", channel: "x" }] });
    const rows = await listPublicationsForAssets(asSupabase(client), []);
    expect(rows).toEqual([]);
    expect(client.queriesFor("content_publications")).toHaveLength(0);
  });

  it("returns only rows matching the given asset ids", async () => {
    const client = new FakeSupabaseClient({
      content_publications: [
        { campaign_asset_id: "a", channel: "x", evidence_type: "owner_confirmed_no_url" },
        { campaign_asset_id: "b", channel: "youtube", evidence_type: "owner_reported_url" },
      ],
    });
    const rows = await listPublicationsForAssets(asSupabase(client), ["a"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.campaignAssetId).toBe("a");
  });
});
