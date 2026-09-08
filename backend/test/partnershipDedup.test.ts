import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { normalizeDomain, normalizeHandle, findExistingMatches } from "../src/partnerships/dedup";

describe("normalizeDomain", () => {
  it("strips protocol, www, path, and query, and lowercases", () => {
    expect(normalizeDomain("https://www.CoachSite.com/about?ref=x")).toBe("coachsite.com");
    expect(normalizeDomain("http://coachsite.com")).toBe("coachsite.com");
    expect(normalizeDomain("coachsite.com")).toBe("coachsite.com"); // no protocol at all
  });
  it("returns null for empty/missing input rather than throwing", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
  it("returns null for genuinely unparseable input rather than guessing", () => {
    expect(normalizeDomain("not a url at all !!!")).toBeNull();
  });
});

describe("normalizeHandle", () => {
  it("lowercases and strips a leading @", () => {
    expect(normalizeHandle("@SomeCoach")).toBe("somecoach");
    expect(normalizeHandle("SomeCoach")).toBe("somecoach");
  });
  it("returns null for empty/missing input", () => {
    expect(normalizeHandle(null)).toBeNull();
    expect(normalizeHandle("")).toBeNull();
  });

  it("extracts the bare handle from a full X/Twitter profile URL -- regression test for a real production bug: createPartnership calls this on socialLinks.x, which discovery.ts always sets to a full URL, and the mismatch against the bare-handle value used everywhere else silently broke dedup, letting every discovery run re-create the same candidates as duplicates", () => {
    expect(normalizeHandle("https://x.com/phinloco")).toBe("phinloco");
    expect(normalizeHandle("https://twitter.com/SomeCoach")).toBe("somecoach");
    expect(normalizeHandle("http://www.x.com/handle")).toBe("handle");
    expect(normalizeHandle("https://x.com/handle/status/123")).toBe("handle"); // trailing path segments ignored
    expect(normalizeHandle("https://x.com/handle?ref=abc")).toBe("handle");
  });

  it("a URL-form handle and its equivalent bare-handle form normalize identically -- the actual guarantee dedup depends on", () => {
    expect(normalizeHandle("https://x.com/phinloco")).toBe(normalizeHandle("@phinloco"));
    expect(normalizeHandle("https://x.com/phinloco")).toBe(normalizeHandle("phinloco"));
  });
});

describe("findExistingMatches -- cross-system dedup", () => {
  it("finds a match in this feature's own history by normalized domain or handle", async () => {
    const client = new FakeSupabaseClient({
      partnership_prospects: [{ id: "p-1", organization_name: "Existing Coach LLC", normalized_domain: "coachsite.com", normalized_handle: null }],
    });
    const matches = await findExistingMatches(asSupabase(client), { domain: "coachsite.com", handle: null });
    expect(matches).toEqual([{ source: "partnership_prospects", id: "p-1", label: "Existing Coach LLC" }]);
  });

  it("finds a match in creators by handle, across any platform", async () => {
    const client = new FakeSupabaseClient({
      partnership_prospects: [],
      creators: [{ id: "creator-1", handle: "somecoach", platform: "x" }],
    });
    const matches = await findExistingMatches(asSupabase(client), { domain: null, handle: "somecoach" });
    expect(matches).toContainEqual({ source: "creators", id: "creator-1", label: "somecoach (x)" });
  });

  it("finds a match in prospecting_candidates (already targeted for public-reply outreach) and inbound_engagements (already engaged with @FillbookHQ)", async () => {
    const client = new FakeSupabaseClient({
      partnership_prospects: [],
      creators: [],
      prospecting_candidates: [{ id: "prospect-cand-1", author_handle: "somecoach" }],
      inbound_engagements: [{ id: "inbound-1", author_handle: "somecoach" }],
    });
    const matches = await findExistingMatches(asSupabase(client), { domain: null, handle: "somecoach" });
    expect(matches).toContainEqual({ source: "prospecting", id: "prospect-cand-1", label: "somecoach" });
    expect(matches).toContainEqual({ source: "inbound", id: "inbound-1", label: "somecoach" });
  });

  it("returns no matches, without querying anything, when both domain and handle are null", async () => {
    const client = new FakeSupabaseClient({ partnership_prospects: [{ id: "p-1", organization_name: "Someone Else", normalized_domain: "other.com", normalized_handle: null }] });
    const matches = await findExistingMatches(asSupabase(client), { domain: null, handle: null });
    expect(matches).toEqual([]);
    expect(client.log.length).toBe(0);
  });

  it("does not false-positive match an unrelated domain/handle", async () => {
    const client = new FakeSupabaseClient({
      partnership_prospects: [{ id: "p-1", organization_name: "Unrelated Org", normalized_domain: "unrelated.com", normalized_handle: null }],
      creators: [{ id: "creator-1", handle: "unrelatedhandle", platform: "x" }],
    });
    const matches = await findExistingMatches(asSupabase(client), { domain: "coachsite.com", handle: "somecoach" });
    expect(matches).toEqual([]);
  });
});
