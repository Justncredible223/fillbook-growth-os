import { describe, it, expect } from "vitest";
import { buildTrackableReplyLink, substituteTrackableLink } from "../src/content/trackableLinks";

describe("buildTrackableReplyLink", () => {
  it("builds a redirect URL carrying the link key and a UTM-tagged fillbookhq.com target", () => {
    const link = buildTrackableReplyLink("prospecting:cand-1", "prospecting", "cand-1");
    expect(link).toMatch(/^https:\/\/fillbook-growth-os\.vercel\.app\/api\/ingest\?/);
    const url = new URL(link);
    expect(url.searchParams.get("source")).toBe("click");
    expect(url.searchParams.get("key")).toBe("prospecting:cand-1");
    const target = new URL(url.searchParams.get("to")!);
    expect(target.hostname).toBe("fillbookhq.com");
    expect(target.searchParams.get("utm_medium")).toBe("prospecting");
    expect(target.searchParams.get("utm_content")).toBe("cand-1");
  });
});

describe("substituteTrackableLink", () => {
  it("replaces every occurrence of the placeholder link with the real one", () => {
    const reply = "Worth checking out: fillbookhq.com/go/prospecting -- fillbookhq.com/go/prospecting again";
    const result = substituteTrackableLink(reply, "fillbookhq.com/go/prospecting", "https://real.link/x");
    expect(result).toBe("Worth checking out: https://real.link/x -- https://real.link/x again");
  });

  it("is a no-op when the placeholder never appears", () => {
    const reply = "No link here at all.";
    expect(substituteTrackableLink(reply, "fillbookhq.com/go/prospecting", "https://real.link/x")).toBe(reply);
  });
});
