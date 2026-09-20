import { describe, it, expect, vi } from "vitest";
import { draftContent } from "../src/content/contentWriter";

function fakeClient() {
  const callTool = vi.fn(async () => ({ body: "ok" }));
  return { callTool } as any;
}

describe("draftContent voice rules", () => {
  it("gives a standalone post the team post voice, and no reply-only rules", async () => {
    const client = fakeClient();
    await draftContent(client, "x", { title: "t", rationale: "r" }, "brand", "facts");
    const [system, user] = client.callTool.mock.calls[0];
    expect(system).toContain("FILLBOOK TEAM VOICE FOR PUBLIC POSTS");
    expect(user).not.toContain("HOW REAL TRADERS ACTUALLY REPLY");
  });

  it("gives a reply to an X mention the reply voice rules", async () => {
    const client = fakeClient();
    await draftContent(client, "x", { title: "t", rationale: "r" }, "brand", "facts", { authorHandle: "someone" });
    expect(client.callTool.mock.calls[0][1]).toContain("HOW REAL TRADERS ACTUALLY REPLY");
  });

  it("does not put the reply rules into a private partnership pitch", async () => {
    const client = fakeClient();
    await draftContent(client, "x", { title: "t", rationale: "r" }, "brand", "facts", undefined, {
      recipientOrganization: "Acme", channel: "email", evidenceExcerpts: ["e"], proposedCollaboration: "c",
    });
    expect(client.callTool.mock.calls[0][1]).not.toContain("HOW REAL TRADERS ACTUALLY REPLY");
  });
});
