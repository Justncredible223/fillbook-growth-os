import { describe, it, expect, vi } from "vitest";
import {
  communityLabelFor,
  draftProspectingCandidateReply,
  markProspectingReplied,
  ProspectingActionError,
} from "../src/prospecting/prospectingHandlers";
import type { ProspectingDraftContext } from "../src/prospecting/prospectingReplyWriter";
import type { NewProspectingCandidate, ProspectingCandidate, ProspectingRepository, ProspectingStatus } from "../src/prospecting/types";

/** Minimal in-memory ProspectingRepository -- enough to drive the handlers without Supabase, and records every outreach call verbatim. */
class InMemoryProspectingRepository implements ProspectingRepository {
  rows = new Map<string, ProspectingCandidate>();
  outreach: Array<{ platform: string; authorExternalId: string; authorHandle: string | null }> = [];

  seed(candidate: ProspectingCandidate) {
    this.rows.set(candidate.id, candidate);
  }

  async upsertIfNew(candidate: NewProspectingCandidate): Promise<{ id: string; created: boolean }> {
    const id = `${candidate.platform}-${candidate.externalId}`;
    const created = !this.rows.has(id);
    if (created) this.rows.set(id, { ...candidate, id, status: "new", shownAt: null, openedAt: null, draftReply: null, finalReply: null, replyMentionsFillbook: null, replyUsedLink: null, repliedAt: null, skipReason: null, createdAt: "", updatedAt: "" });
    return { id, created };
  }

  async listByStatus(statuses: ProspectingStatus[]): Promise<ProspectingCandidate[]> {
    return [...this.rows.values()].filter((r) => statuses.includes(r.status));
  }

  async getById(id: string): Promise<ProspectingCandidate | null> {
    return this.rows.get(id) ?? null;
  }

  async markShown(ids: string[]): Promise<void> {
    for (const id of ids) {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, status: "shown" });
    }
  }

  async updateStatus(id: string, status: ProspectingStatus, fields: Partial<ProspectingCandidate> = {}): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    this.rows.set(id, { ...row, ...defined, status });
  }

  async hasPriorOutreach(platform: string, authorExternalId: string): Promise<boolean> {
    return this.outreach.some((o) => o.platform === platform && o.authorExternalId === authorExternalId);
  }

  async recordOutreach(platform: string, authorExternalId: string, authorHandle: string | null): Promise<void> {
    this.outreach.push({ platform, authorExternalId, authorHandle });
  }

  async expireStale(): Promise<number> {
    return 0;
  }
}

function candidate(overrides: Partial<ProspectingCandidate>): ProspectingCandidate {
  return {
    id: "cand-1",
    platform: "x",
    externalId: "123",
    discoveryQuery: "trailing_drawdown",
    authorHandle: "someTrader",
    authorExternalId: "author-123",
    authorName: "Some Trader",
    authorFollowerCount: 100,
    authorVerified: false,
    postText: "does trailing drawdown reset daily?",
    postUrl: "https://x.com/i/web/status/123",
    postCreatedAt: null,
    publicMetrics: {},
    opportunityScore: 70,
    scoreBreakdown: {},
    creatorCandidate: false,
    status: "ready",
    shownAt: null,
    openedAt: null,
    draftReply: "Most firms reset EOD.",
    finalReply: null,
    replyMentionsFillbook: false,
    replyUsedLink: false,
    repliedAt: null,
    skipReason: null,
    discoveredAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const fakeClient = {} as any;

describe("markProspectingReplied -- outreach is recorded in the candidate's own platform namespace", () => {
  it("a Reddit reply records Reddit outreach keyed by the Reddit username, never under 'x'", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "reddit-1", platform: "reddit", authorHandle: "redditTrader", authorExternalId: "redditTrader", postUrl: "https://www.reddit.com/r/FuturesTrading/comments/abc/x/" }));

    const updated = await markProspectingReplied(fakeClient, "reddit-1", undefined, undefined, undefined, { repo });

    expect(updated.status).toBe("replied");
    expect(repo.outreach).toEqual([{ platform: "reddit", authorExternalId: "redditTrader", authorHandle: "redditTrader" }]);
    expect(await repo.hasPriorOutreach("reddit", "redditTrader")).toBe(true);
    expect(await repo.hasPriorOutreach("x", "redditTrader")).toBe(false);
  });

  it("an X reply still records X outreach keyed by the X author id", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-1", platform: "x", authorHandle: "xTrader", authorExternalId: "9001" }));

    await markProspectingReplied(fakeClient, "x-1", undefined, undefined, undefined, { repo });

    expect(repo.outreach).toEqual([{ platform: "x", authorExternalId: "9001", authorHandle: "xTrader" }]);
    expect(await repo.hasPriorOutreach("x", "9001")).toBe(true);
    expect(await repo.hasPriorOutreach("reddit", "9001")).toBe(false);
  });

  it("stores an edited final reply only when it differs from the draft, and keeps the model's flags when the caller passes none", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-2", draftReply: "draft", replyMentionsFillbook: true, replyUsedLink: false }));

    const same = await markProspectingReplied(fakeClient, "x-2", "draft", undefined, undefined, { repo });
    expect(same.finalReply).toBeNull();
    expect(same.replyMentionsFillbook).toBe(true);

    repo.seed(candidate({ id: "x-3", draftReply: "draft" }));
    const edited = await markProspectingReplied(fakeClient, "x-3", "edited by hand", undefined, undefined, { repo });
    expect(edited.finalReply).toBe("edited by hand");
  });

  it("does not record outreach when the author has no stable external id", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-4", authorExternalId: null }));

    await markProspectingReplied(fakeClient, "x-4", undefined, undefined, undefined, { repo });

    expect(repo.outreach).toEqual([]);
  });

  it("throws ProspectingActionError for an unknown id", async () => {
    const repo = new InMemoryProspectingRepository();
    await expect(markProspectingReplied(fakeClient, "missing", undefined, undefined, undefined, { repo })).rejects.toThrow(ProspectingActionError);
  });
});

describe("draftProspectingCandidateReply -- the candidate's platform reaches the drafter", () => {
  const loadGrounding = async () => ({ brandRulesSummary: "rules", verifiedKnowledgeSummary: "facts" });

  it("a Reddit candidate is drafted with platform=reddit and its subreddit label, and the draft is persisted", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "reddit-1", platform: "reddit", status: "shown", draftReply: null, authorHandle: "redditTrader", postUrl: "https://www.reddit.com/r/FuturesTrading/comments/abc/some_title/" }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ reply: "Depends on the firm -- most use EOD balance.", mentionsFillbook: false, usesLink: false }));

    const updated = await draftProspectingCandidateReply(fakeClient, "reddit-1", { repo, drafter, loadGrounding });

    expect(drafter).toHaveBeenCalledTimes(1);
    expect(drafter.mock.calls[0]![0]).toMatchObject({ platform: "reddit", communityLabel: "r/FuturesTrading", authorHandle: "redditTrader" });
    expect(updated.status).toBe("ready");
    expect(updated.draftReply).toBe("Depends on the firm -- most use EOD balance.");
    expect(updated.replyMentionsFillbook).toBe(false);
  });

  it("an X candidate is drafted with platform=x and no community label", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-1", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ reply: "EOD for most firms.", mentionsFillbook: false, usesLink: false }));

    await draftProspectingCandidateReply(fakeClient, "x-1", { repo, drafter, loadGrounding });

    expect(drafter.mock.calls[0]![0]).toMatchObject({ platform: "x", communityLabel: null });
  });

  it("REFINED: rejects and never persists a draft that trips the mechanical reply guardrail -- an overly promotional banned phrase -- even though the model's own flags say mentionsFillbook=false", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-2", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({
      reply: "Struggling with this? Check out our platform, it solves exactly this!",
      mentionsFillbook: false,
      usesLink: false,
    }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-2", { repo, drafter, loadGrounding })).rejects.toThrow(/banned generic phrase/);

    const row = await repo.getById("x-2");
    expect(row!.status).toBe("shown"); // never advanced to 'ready' -- the rejected draft was never persisted
    expect(row!.draftReply).toBeNull();
  });

  it("REFINED: rejects a draft with an unsupported customer-result claim", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-3", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({
      reply: "Our traders saved 30% on drawdown violations after switching.",
      mentionsFillbook: true,
      usesLink: false,
    }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-3", { repo, drafter, loadGrounding })).rejects.toThrow(ProspectingActionError);
  });

  it("REFINED: the guardrail applies to Reddit too, not just X -- a banned generic phrase is rejected regardless of platform", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "reddit-2", platform: "reddit", status: "shown", draftReply: null, postUrl: "https://www.reddit.com/r/FuturesTrading/comments/abc/x/" }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({
      reply: "Learn more about how Fillbook handles this in our docs.",
      mentionsFillbook: true,
      usesLink: false,
    }));

    await expect(draftProspectingCandidateReply(fakeClient, "reddit-2", { repo, drafter, loadGrounding })).rejects.toThrow(/banned generic phrase/);

    const row = await repo.getById("reddit-2");
    expect(row!.status).toBe("shown");
    expect(row!.draftReply).toBeNull();
  });
});

describe("communityLabelFor", () => {
  it("extracts the subreddit from a Reddit permalink", () => {
    expect(communityLabelFor({ platform: "reddit", postUrl: "https://www.reddit.com/r/FuturesTrading/comments/abc/x/" })).toBe("r/FuturesTrading");
  });

  it("returns null for X and for a Reddit URL without a recognizable subreddit", () => {
    expect(communityLabelFor({ platform: "x", postUrl: "https://x.com/i/web/status/1" })).toBeNull();
    expect(communityLabelFor({ platform: "reddit", postUrl: "https://www.reddit.com/user/someone/" })).toBeNull();
  });
});
