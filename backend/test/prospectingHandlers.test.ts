import { describe, it, expect, vi } from "vitest";
import {
  draftProspectingCandidateReply,
  listProspectingQueue,
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

/**
 * Regression coverage for the 2026-09-07 freshness/audience-quality
 * review's diagnostics addition: before this existed, an empty or small
 * daily set from listProspectingQueue was ambiguous -- "genuinely nothing
 * found" and "plenty of backlog, all of it too old/too weak today" looked
 * identical from the API response alone. These prove the counts are
 * real, additive, and actually distinguish those cases.
 */
describe("listProspectingQueue -- selection diagnostics", () => {
  const NOW = new Date("2026-09-07T12:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

  it("reports counts that are additive and distinguish selected / below-quality-bar / too-old", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "fresh-strong", status: "new", opportunityScore: 70, postCreatedAt: hoursAgo(1), authorExternalId: "a" }));
    repo.seed(candidate({ id: "weak", status: "new", opportunityScore: 10, postCreatedAt: hoursAgo(1), authorExternalId: "b" }));
    repo.seed(candidate({ id: "ancient", status: "new", opportunityScore: 90, postCreatedAt: hoursAgo(24 * 10), authorExternalId: "c" }));

    const { candidates, diagnostics } = await listProspectingQueue(fakeClient, NOW, { repo });

    expect(candidates.map((c) => c.id)).toEqual(["fresh-strong"]);
    expect(diagnostics).toEqual({ totalConsidered: 3, selected: 1, deferred: 0, belowQualityBar: 1, tooOldForToday: 1 });
  });

  it("never leaves an empty daily set ambiguous -- diagnostics show whether the backlog is genuinely clear or just mostly too old", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "stale-1", status: "shown", opportunityScore: 95, postCreatedAt: hoursAgo(24 * 6), authorExternalId: "a" }));
    repo.seed(candidate({ id: "stale-2", status: "shown", opportunityScore: 95, postCreatedAt: hoursAgo(24 * 8), authorExternalId: "b" }));

    const { candidates, diagnostics } = await listProspectingQueue(fakeClient, NOW, { repo });

    expect(candidates).toHaveLength(0);
    expect(diagnostics.totalConsidered).toBe(2);
    expect(diagnostics.tooOldForToday).toBe(2); // NOT a genuinely empty backlog -- both excluded for age specifically
    expect(diagnostics.belowQualityBar).toBe(0);
  });

  it("reports a genuinely empty backlog as zero everywhere, not conflated with an age or quality exclusion", async () => {
    const repo = new InMemoryProspectingRepository();
    const { candidates, diagnostics } = await listProspectingQueue(fakeClient, NOW, { repo });

    expect(candidates).toHaveLength(0);
    expect(diagnostics).toEqual({ totalConsidered: 0, selected: 0, deferred: 0, belowQualityBar: 0, tooOldForToday: 0 });
  });
});

describe("markProspectingReplied -- outreach is recorded in the candidate's own platform namespace", () => {
  it("an X reply still records X outreach keyed by the X author id", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-1", platform: "x", authorHandle: "xTrader", authorExternalId: "9001" }));

    await markProspectingReplied(fakeClient, "x-1", undefined, undefined, undefined, { repo });

    expect(repo.outreach).toEqual([{ platform: "x", authorExternalId: "9001", authorHandle: "xTrader" }]);
    expect(await repo.hasPriorOutreach("x", "9001")).toBe(true);
    expect(await repo.hasPriorOutreach("youtube", "9001")).toBe(false);
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

/**
 * Regression coverage for the system_settings.paused gate added to
 * scheduled discovery (runProspectingSearch/runPartnershipDiscoveryStep):
 * reviewing an already-discovered candidate must never be affected by
 * pause state, since pausing is meant to stop unattended spend, not lock
 * the owner out of their own queue. Neither handler here accepts or
 * consults an isPaused dependency at all, and fakeClient is `{} as any` --
 * if either handler ever grew a `client.from("system_settings")` read
 * (accidentally coupling review to the pause flag), these tests would fail
 * immediately with "fakeClient.from is not a function" rather than silently
 * passing.
 */
describe("existing candidate review is unaffected by system pause state", () => {
  const loadGrounding = async () => ({ brandRulesSummary: "rules", verifiedKnowledgeSummary: "facts" });

  it("draftProspectingCandidateReply succeeds with no isPaused dependency in play", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "paused-1", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "EOD for most firms.", mentionsFillbook: false, usesLink: false }));

    const updated = await draftProspectingCandidateReply(fakeClient, "paused-1", { repo, drafter, loadGrounding });

    expect(updated.status).toBe("ready");
    expect(updated.draftReply).toBe("EOD for most firms.");
  });

  it("markProspectingReplied succeeds with no isPaused dependency in play", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "paused-2", authorExternalId: "9002" }));

    const updated = await markProspectingReplied(fakeClient, "paused-2", undefined, undefined, undefined, { repo });

    expect(updated.status).toBe("replied");
    expect(await repo.hasPriorOutreach("x", "9002")).toBe(true);
  });
});

describe("draftProspectingCandidateReply -- the candidate's platform reaches the drafter", () => {
  const loadGrounding = async () => ({ brandRulesSummary: "rules", verifiedKnowledgeSummary: "facts" });

  it("an X candidate is drafted with platform=x", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-1", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "EOD for most firms.", mentionsFillbook: false, usesLink: false }));

    const updated = await draftProspectingCandidateReply(fakeClient, "x-1", { repo, drafter, loadGrounding });

    expect(drafter).toHaveBeenCalledTimes(1);
    expect(drafter.mock.calls[0]![0]).toMatchObject({ platform: "x" });
    expect(updated.status).toBe("ready");
    expect(updated.draftReply).toBe("EOD for most firms.");
    expect(updated.replyMentionsFillbook).toBe(false);
  });

  it("REFINED: rejects and never persists a draft that trips the mechanical reply guardrail -- an overly promotional banned phrase -- even though the model's own flags say mentionsFillbook=false", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-2", platform: "x", status: "shown", draftReply: null }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({
      isRelevant: true,
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
      isRelevant: true,
      reply: "Our traders saved 30% on drawdown violations after switching.",
      mentionsFillbook: true,
      usesLink: false,
    }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-3", { repo, drafter, loadGrounding })).rejects.toThrow(ProspectingActionError);
  });
});

/**
 * Regression coverage for a real, confirmed bug: Prospecting surfaced
 * posts with zero connection to futures/trading (a sci-fi story teaser
 * scored 51 and got queued), and when drafted anyway, the model's only
 * way to flag the mismatch was writing it into the reply text itself
 * (e.g. "this event isn't futures related") -- shown to the owner as if
 * it were a usable draft. Two independent gates close this: a mechanical
 * $0 pre-filter (prospectingRelevance.ts) that runs before any LLM call,
 * and the model's own isRelevant flag for content that slips past it.
 */
describe("draftProspectingCandidateReply -- relevance gates", () => {
  const loadGrounding = async () => ({ brandRulesSummary: "rules", verifiedKnowledgeSummary: "facts" });

  it("rejects an obviously irrelevant (sci-fi) post before ever calling the drafter -- the mechanical pre-filter", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(
      candidate({
        id: "x-scifi",
        status: "shown",
        draftReply: null,
        postText:
          "What if trust begins where certainty ends? In #2084, a civilization built on prediction discovers the one thing an algorithm cannot give you: a reason...",
      }),
    );
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "should never be called", mentionsFillbook: false, usesLink: false }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-scifi", { repo, drafter, loadGrounding })).rejects.toThrow(/not eligible for drafting/i);

    expect(drafter).not.toHaveBeenCalled();
    const row = await repo.getById("x-scifi");
    expect(row!.status).toBe("not_relevant");
    expect(row!.draftReply).toBeNull();
  });

  it("rejects a generic non-trading post (bare 'entry'/'performance' words only) before calling the drafter", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(
      candidate({
        id: "x-generic",
        status: "shown",
        draftReply: null,
        postText: "Every entry into the competition counts toward your final performance score.",
      }),
    );
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "should never be called", mentionsFillbook: false, usesLink: false }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-generic", { repo, drafter, loadGrounding })).rejects.toThrow(/not eligible for drafting/i);
    expect(drafter).not.toHaveBeenCalled();
  });

  it("a genuine futures post passes the pre-filter and reaches the drafter", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(candidate({ id: "x-futures", status: "shown", draftReply: null, postText: "Been trading MNQ futures for two years, still get nervous before the open." }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "Two years in and still nervous is normal -- it means you still respect the risk.", mentionsFillbook: false, usesLink: false }));

    const updated = await draftProspectingCandidateReply(fakeClient, "x-futures", { repo, drafter, loadGrounding });

    expect(drafter).toHaveBeenCalledTimes(1);
    expect(updated.status).toBe("ready");
  });

  it("a genuine prop-firm/drawdown post (no 'futures' word at all) passes the pre-filter and reaches the drafter", async () => {
    const repo = new InMemoryProspectingRepository();
    repo.seed(
      candidate({
        id: "x-propfirm",
        status: "shown",
        draftReply: null,
        postText: "Failed my prop firm evaluation because of a trailing drawdown rule I didn't fully understand.",
      }),
    );
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({ isRelevant: true, reply: "That rule catches a lot of people -- worth reading the fine print before the next attempt.", mentionsFillbook: false, usesLink: false }));

    const updated = await draftProspectingCandidateReply(fakeClient, "x-propfirm", { repo, drafter, loadGrounding });

    expect(drafter).toHaveBeenCalledTimes(1);
    expect(updated.status).toBe("ready");
  });

  it("the pre-filter passes but the model itself judges the post not relevant -- no draft is persisted, never shown as if usable", async () => {
    const repo = new InMemoryProspectingRepository();
    // postText passes the mechanical pre-filter (contains "trading"), but
    // the model itself determines the post isn't genuinely about trading
    // -- e.g. "trading cards" or "horse trading" style non-financial use.
    repo.seed(candidate({ id: "x-modeljudged", status: "shown", draftReply: null, postText: "Spent the whole weekend trading Pokemon cards with my kid at the local shop." }));
    const drafter = vi.fn(async (_ctx: ProspectingDraftContext) => ({
      isRelevant: false,
      reply: "",
      mentionsFillbook: false,
      usesLink: false,
    }));

    await expect(draftProspectingCandidateReply(fakeClient, "x-modeljudged", { repo, drafter, loadGrounding })).rejects.toThrow(/not eligible for drafting/i);

    expect(drafter).toHaveBeenCalledTimes(1); // pre-filter passed, so it DID reach the drafter this time
    const row = await repo.getById("x-modeljudged");
    expect(row!.status).toBe("not_relevant");
    expect(row!.draftReply).toBeNull(); // never persisted, regardless of what draft.reply contained
  });
});
