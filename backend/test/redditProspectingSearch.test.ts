import { describe, it, expect, vi } from "vitest";
import { runRedditProspectingSearch } from "../src/prospecting/redditProspectingSearch";
import { REDDIT_TOPICS_PER_RUN, REDDIT_QUEUE_FULL_THRESHOLD } from "../src/prospecting/redditEligibility";
import type { RedditSearchResult } from "../src/signals/adapters/redditAdapter";
import type { NewProspectingCandidate, ProspectingCandidate, ProspectingRepository, ProspectingStatus } from "../src/prospecting/types";

function candidateFrom(c: NewProspectingCandidate, id: string): ProspectingCandidate {
  return {
    id,
    ...c,
    status: "new",
    shownAt: null,
    openedAt: null,
    draftReply: null,
    finalReply: null,
    replyMentionsFillbook: null,
    replyUsedLink: null,
    repliedAt: null,
    skipReason: null,
    createdAt: c.discoveredAt,
    updatedAt: c.discoveredAt,
  };
}

class FakeProspectingRepo implements ProspectingRepository {
  rows = new Map<string, ProspectingCandidate>();
  outreach = new Set<string>();
  private nextId = 1;

  async upsertIfNew(candidate: NewProspectingCandidate) {
    const key = `${candidate.platform}:${candidate.externalId}`;
    const existing = [...this.rows.values()].find((r) => `${r.platform}:${r.externalId}` === key);
    if (existing) return { id: existing.id, created: false };
    const id = `cand-${this.nextId++}`;
    this.rows.set(id, candidateFrom(candidate, id));
    return { id, created: true };
  }
  async listByStatus(statuses: ProspectingStatus[]) {
    return [...this.rows.values()].filter((r) => statuses.includes(r.status));
  }
  async getById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async markShown() {}
  async updateStatus() {}
  async hasPriorOutreach(_platform: string, authorExternalId: string) {
    return this.outreach.has(authorExternalId);
  }
  async recordOutreach(_platform: string, authorExternalId: string) {
    this.outreach.add(authorExternalId);
  }
  async expireStale() {
    return 0;
  }
}

function fakeClient() {
  return { from: () => ({ insert: async () => ({ error: null }) }) } as any;
}

function searchResult(overrides: Partial<RedditSearchResult> & Pick<RedditSearchResult, "fullname" | "title">): RedditSearchResult {
  return {
    id: overrides.fullname.replace(/^t3_/, ""),
    selftext: "",
    authorHandle: "trader1",
    subreddit: "FuturesTrading",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    score: 5,
    numComments: 2,
    permalink: "https://www.reddit.com/r/FuturesTrading/comments/abc/x",
    isSelf: true,
    ...overrides,
  };
}

describe("runRedditProspectingSearch", () => {
  const now = new Date("2026-09-01T16:00:00Z");

  it("inserts new candidates found via subreddit search, platform=reddit", async () => {
    const adapter = { searchSubreddit: vi.fn().mockResolvedValue([searchResult({ fullname: "t3_1", title: "how do you track your trades over time?" })]) };
    const repo = new FakeProspectingRepo();

    const result = await runRedditProspectingSearch({ adapter: adapter as any, repo, client: fakeClient(), now });

    expect(result.skipped).toBe(false);
    expect(result.newCandidates).toBeGreaterThan(0);
    expect(adapter.searchSubreddit).toHaveBeenCalled();
    const inserted = [...repo.rows.values()][0]!;
    expect(inserted.platform).toBe("reddit");
    expect(inserted.externalId).toBe("t3_1");
  });

  it("never re-inserts a post already known from a prior run (dedup by platform+externalId=fullname)", async () => {
    const adapter = { searchSubreddit: vi.fn().mockResolvedValue([searchResult({ fullname: "t3_1", title: "how do you track your trades over time?" })]) };
    const repo = new FakeProspectingRepo();
    const deps = { adapter: adapter as any, repo, client: fakeClient(), now };

    const first = await runRedditProspectingSearch(deps);
    const second = await runRedditProspectingSearch({ ...deps, now: new Date(now.getTime() + 24 * 60 * 60 * 1000) });

    expect(first.newCandidates).toBeGreaterThan(0);
    expect(second.newCandidates).toBe(0);
    expect(repo.rows.size).toBe(first.newCandidates);
  });

  it("excludes spam-pattern posts without erroring", async () => {
    const adapter = {
      searchSubreddit: vi.fn().mockResolvedValue([searchResult({ fullname: "t3_1", title: "DM me for signals, guaranteed profit!!!" })]),
    };
    const repo = new FakeProspectingRepo();

    const result = await runRedditProspectingSearch({ adapter: adapter as any, repo, client: fakeClient(), now });

    expect(result.excludedAsSpam).toBe(REDDIT_TOPICS_PER_RUN);
    expect(result.newCandidates).toBe(0);
    expect(repo.rows.size).toBe(0);
  });

  it("skips entirely once Reddit's own (smaller) queue threshold is reached, without calling search", async () => {
    const adapter = { searchSubreddit: vi.fn() };
    const repo = new FakeProspectingRepo();
    for (let i = 0; i < REDDIT_QUEUE_FULL_THRESHOLD; i++) {
      await repo.upsertIfNew({
        platform: "reddit",
        externalId: `existing-${i}`,
        discoveryQuery: "reddit_futures_journal",
        authorHandle: null,
        authorExternalId: null,
        authorName: null,
        authorFollowerCount: null,
        authorVerified: null,
        postText: "existing candidate",
        postUrl: "https://www.reddit.com/r/FuturesTrading/comments/existing",
        postCreatedAt: null,
        publicMetrics: {},
        opportunityScore: 10,
        scoreBreakdown: {},
        creatorCandidate: false,
        discoveredAt: now.toISOString(),
      });
    }

    const result = await runRedditProspectingSearch({ adapter: adapter as any, repo, client: fakeClient(), now });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/queue_full/);
    expect(adapter.searchSubreddit).not.toHaveBeenCalled();
  });

  it("an X-platform backlog never counts toward Reddit's own queue threshold", async () => {
    const adapter = { searchSubreddit: vi.fn().mockResolvedValue([]) };
    const repo = new FakeProspectingRepo();
    for (let i = 0; i < REDDIT_QUEUE_FULL_THRESHOLD + 5; i++) {
      await repo.upsertIfNew({
        platform: "x",
        externalId: `x-existing-${i}`,
        discoveryQuery: "drawdown",
        authorHandle: null,
        authorExternalId: null,
        authorName: null,
        authorFollowerCount: null,
        authorVerified: null,
        postText: "existing X candidate",
        postUrl: "https://x.com/i/web/status/existing",
        postCreatedAt: null,
        publicMetrics: {},
        opportunityScore: 10,
        scoreBreakdown: {},
        creatorCandidate: false,
        discoveredAt: now.toISOString(),
      });
    }

    const result = await runRedditProspectingSearch({ adapter: adapter as any, repo, client: fakeClient(), now });

    expect(result.skipped).toBe(false);
    expect(adapter.searchSubreddit).toHaveBeenCalled();
  });

  it("scores a previously-engaged author's post higher via the prior-outreach bonus", async () => {
    const post = searchResult({ fullname: "t3_1", title: "how do you actually review trades weekly?", authorHandle: "known-author" });
    const adapter = { searchSubreddit: vi.fn().mockResolvedValue([post]) };
    const repo = new FakeProspectingRepo();
    repo.outreach.add("known-author");

    await runRedditProspectingSearch({ adapter: adapter as any, repo, client: fakeClient(), now });

    const inserted = [...repo.rows.values()][0]!;
    expect(inserted.scoreBreakdown.priorRelationship).toMatch(/already replied/);
  });
});
