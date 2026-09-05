import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import {
  PartnershipActionError,
  activatePartnership,
  archivePartnership,
  closePartnership,
  createPartnership,
  generateDraftForPartnership,
  listPartnerships,
  markPartnershipContacted,
  markPartnershipDoNotContact,
  qualifyPartnership,
  recordPartnershipOutcome,
  recordPartnershipReply,
  startPartnershipPilot,
} from "../src/partnerships/partnershipsHandlers";
import type { NewPartnershipProspect } from "../src/partnerships/types";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
function draftResponse(body: string) {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_draft", input: { body } }] });
}
function verdictResponse(pass: boolean, reasoning = "ok") {
  return jsonResponse({ content: [{ type: "tool_use", name: "submit_verdict", input: { pass, score: pass ? 1 : 0.2, reasoning, issues: [] } }] });
}
function verdicts(pass: boolean, reasoning = "ok"): Response[] {
  return Array.from({ length: 9 }, () => verdictResponse(pass, reasoning));
}
function sequenceFetch(responses: Response[]) {
  let i = 0;
  return vi.fn(async (_url?: string, _init?: RequestInit) => responses[Math.min(i++, responses.length - 1)]!);
}

const GOOD_DRAFT = "Fillbook is a broker-agnostic futures trading journal built for session review and visible account-rule tracking -- a natural fit for a guided journaling pilot with a small cohort of your students.";

function newProspect(overrides: Partial<NewPartnershipProspect> = {}): NewPartnershipProspect {
  return {
    organizationName: "Example Trading Coach LLC",
    partnerCategory: "educator_coach",
    websiteUrl: "https://coachsite.com",
    proposedCollaboration: "A guided journaling pilot for a small cohort of the coach's students.",
    ...overrides,
  };
}

function buildClient(overrides: Record<string, any[]> = {}) {
  return new FakeSupabaseClient({
    partnership_prospects: [],
    partnership_interactions: [],
    partnership_outcomes: [],
    cost_events: [],
    brand_rules: [],
    knowledge_documents: [],
    opportunities: [],
    campaigns: [],
    campaign_assets: [],
    content_versions: [],
    content_scores: [],
    ...overrides,
  });
}

describe("createPartnership -- dedup is informational, never blocking", () => {
  it("creates a prospect and reports zero existing matches when nothing overlaps", async () => {
    const client = buildClient();
    const { prospect, existingMatches } = await createPartnership(asSupabase(client), newProspect());
    expect(prospect.organizationName).toBe("Example Trading Coach LLC");
    expect(prospect.stage).toBe("prospect");
    expect(existingMatches).toEqual([]);
  });

  it("still creates the prospect even when a cross-system match is found, but reports it", async () => {
    const client = buildClient({ creators: [{ id: "creator-1", handle: "coachsite", platform: "x" }] });
    const { existingMatches } = await createPartnership(asSupabase(client), newProspect({ socialLinks: { x: "@coachsite" } }));
    expect(existingMatches.some((m) => m.source === "creators")).toBe(true);
  });
});

describe("qualifyPartnership -- stage-guarded", () => {
  it("moves prospect -> qualified and records the rationale", async () => {
    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    const qualified = await qualifyPartnership(asSupabase(client), prospect.id, "Real evidence of futures audience, no competing journal.");
    expect(qualified.stage).toBe("qualified");
    expect(qualified.qualificationRationale).toContain("Real evidence");
  });

  it("refuses to qualify a prospect that is not in 'prospect' stage", async () => {
    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await expect(qualifyPartnership(asSupabase(client), prospect.id, "again")).rejects.toThrow(PartnershipActionError);
  });

  it("404s cleanly for a nonexistent id rather than throwing an unrelated error", async () => {
    const client = buildClient();
    await expect(qualifyPartnership(asSupabase(client), "no-such-id", "x")).rejects.toThrow(/No partnership prospect found/);
  });
});

describe("generateDraftForPartnership -- reuses the real pipeline, full rigor", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("passes mechanical gate + all 9 reviewers on the first attempt -> draft_ready with an approved campaign_asset", async () => {
    const fetchMock = sequenceFetch([draftResponse(GOOD_DRAFT), ...verdicts(true)]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "Good fit.");

    const result = await generateDraftForPartnership(asSupabase(client), prospect.id);

    expect(result.status).toBe("ready");
    expect(result.campaignAssetId).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(10); // 1 draft + 9 reviewers -- same full rigor as every other content type

    const updated = (await listPartnerships(asSupabase(client))).find((p) => p.id === prospect.id)!;
    expect(updated.stage).toBe("draft_ready");
    expect(updated.approvedCampaignAssetId).toBe(result.campaignAssetId);
  });

  it("refuses to generate a draft before proposedCollaboration is set -- no blank-ask pitches", async () => {
    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect({ proposedCollaboration: undefined }));
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await expect(generateDraftForPartnership(asSupabase(client), prospect.id)).rejects.toThrow(/proposedCollaboration/);
  });

  it("a mechanical gate failure records the failed attempt without reaching draft_ready", async () => {
    const fetchMock = sequenceFetch([draftResponse("When I traded NQ today I caught a great move.")]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildClient({
      brand_rules: [
        {
          id: "r1",
          version: 1,
          rule_type: "claim_prohibited",
          content: "Fillbook must never speak or be shown as if it personally trades -- no fake personal trading story, ever.",
          source_doc: null,
          is_active: true,
        },
      ],
    });
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");

    const result = await generateDraftForPartnership(asSupabase(client), prospect.id);

    expect(result.status).toBe("failed");
    const updated = (await listPartnerships(asSupabase(client))).find((p) => p.id === prospect.id)!;
    expect(updated.stage).toBe("qualified"); // unchanged -- never advanced on a failed attempt
    expect(updated.approvedCampaignAssetId).toBeNull();
  });

  it("bounded revision: a first attempt rejected by review is retried ONCE with that feedback, and a passing second attempt reports attempts:2", async () => {
    const fetchMock = sequenceFetch([
      draftResponse("Hi -- interested in a pilot?"), // attempt 1 draft
      ...verdicts(false, "too generic, no recipient-specific evidence"), // attempt 1: all 9 reject
      draftResponse(GOOD_DRAFT), // attempt 2 draft (writer sees priorFeedback)
      ...verdicts(true), // attempt 2: all 9 pass
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "Good fit.");

    const result = await generateDraftForPartnership(asSupabase(client), prospect.id);

    expect(result.status).toBe("ready");
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(20); // 2 full (draft + 9 reviewers) attempts

    // The second attempt's draft call must actually carry the first attempt's rejection reasons.
    const secondDraftUserMessage = JSON.parse((fetchMock.mock.calls[10]![1] as RequestInit).body as string).messages[0].content as string;
    expect(secondDraftUserMessage).toContain("A prior draft was rejected for these specific reasons");
    expect(secondDraftUserMessage).toContain("too generic");
  });

  it("never retries a third time -- two straight rejections stop at attempts:2, still reported as failed", async () => {
    const fetchMock = sequenceFetch([
      draftResponse("Hi -- interested in a pilot?"),
      ...verdicts(false, "still generic"),
      draftResponse("Hi -- still interested in a pilot?"),
      ...verdicts(false, "still generic"),
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "Good fit.");

    const result = await generateDraftForPartnership(asSupabase(client), prospect.id);

    expect(result.status).toBe("failed");
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(20); // exactly 2 attempts, never a 3rd
  });

  it("threads the recipient's real evidence excerpts to every reviewer, not just the recipient name", async () => {
    const fetchMock = sequenceFetch([draftResponse(GOOD_DRAFT), ...verdicts(true)]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect({ evidenceExcerpts: ["We run a 6-week risk-management cohort for funded futures traders."] }));
    await qualifyPartnership(asSupabase(client), prospect.id, "Good fit.");

    await generateDraftForPartnership(asSupabase(client), prospect.id);

    const reviewerCallBody = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    const reviewerUserMessage = reviewerCallBody.messages[0].content as string;
    expect(reviewerUserMessage).toContain("6-week risk-management cohort");
  });

  it("is skipped, spending nothing, once the independent partnership budget is exhausted -- never touches auto-draft/prospecting/x-feed-post's own budgets", async () => {
    const client = buildClient({
      cost_events: [{ event_type: "partnership_llm_call", cost_usd: 999, created_at: new Date().toISOString() }],
    });
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateDraftForPartnership(asSupabase(client), prospect.id);

    expect(result.status).toBe("skipped");
    expect(result.skipReason).toMatch(/monthly_budget_reached/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("markPartnershipContacted -- requires an actual approved draft, never inferred", () => {
  it("refuses when there is no approved draft yet", async () => {
    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await expect(markPartnershipContacted(asSupabase(client), prospect.id, "email", "Hi there")).rejects.toThrow(/Cannot mark contacted/);
  });

  it("succeeds once draft_ready with an approved draft, recording the real channel and final (possibly owner-edited) text", async () => {
    const originalFetch = global.fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = sequenceFetch([draftResponse(GOOD_DRAFT), ...verdicts(true)]) as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await generateDraftForPartnership(asSupabase(client), prospect.id);

    const contacted = await markPartnershipContacted(asSupabase(client), prospect.id, "email", "Hi -- edited final version of the pitch.");
    expect(contacted.stage).toBe("contacted");
    expect(contacted.contactedChannel).toBe("email");
    expect(contacted.contactedAt).not.toBeNull();

    global.fetch = originalFetch;
  });
});

describe("startPartnershipPilot -- the backend path behind Android's new 'Start pilot' action", () => {
  it("refuses to start a pilot before a reply has actually been recorded", async () => {
    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    // Still 'qualified' -- no draft, no contact, no reply yet.
    await expect(startPartnershipPilot(asSupabase(client), prospect.id, "Free access for 10 students", "2026-10-01")).rejects.toThrow(PartnershipActionError);
  });

  it("succeeds once replied, persisting the agreed terms and start date", async () => {
    const originalFetch = global.fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = sequenceFetch([draftResponse(GOOD_DRAFT), ...verdicts(true)]) as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await generateDraftForPartnership(asSupabase(client), prospect.id);
    await markPartnershipContacted(asSupabase(client), prospect.id, "email", GOOD_DRAFT);
    await recordPartnershipReply(asSupabase(client), prospect.id, "They said yes.");

    const piloted = await startPartnershipPilot(asSupabase(client), prospect.id, "Free access for 10 students, 60-day pilot.", "2026-10-01");

    expect(piloted.stage).toBe("pilot");
    expect(piloted.pilotTermsAgreed).toBe("Free access for 10 students, 60-day pilot.");
    expect(piloted.pilotStartDate).toBe("2026-10-01");

    global.fetch = originalFetch;
  });
});

describe("full lifecycle -- replied -> pilot -> active_partner -> closed, plus outcomes", () => {
  it("walks the whole graph and records outcomes distinctly as measured vs manual", async () => {
    const originalFetch = global.fetch;
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = sequenceFetch([draftResponse(GOOD_DRAFT), ...verdicts(true)]) as unknown as typeof fetch;

    const client = buildClient();
    const { prospect } = await createPartnership(asSupabase(client), newProspect());
    await qualifyPartnership(asSupabase(client), prospect.id, "ok");
    await generateDraftForPartnership(asSupabase(client), prospect.id);
    await markPartnershipContacted(asSupabase(client), prospect.id, "email", GOOD_DRAFT);
    const replied = await recordPartnershipReply(asSupabase(client), prospect.id, "They said yes, interested in a small pilot.");
    expect(replied.stage).toBe("replied");

    const piloted = await startPartnershipPilot(asSupabase(client), prospect.id, "Free access for 10 students, 60-day pilot.", "2026-10-01");
    expect(piloted.stage).toBe("pilot");

    await recordPartnershipOutcome(asSupabase(client), prospect.id, "signups", 4, "measured");
    await recordPartnershipOutcome(asSupabase(client), prospect.id, "activations", 2, "manual_entry", "Coach reported via email, no direct tracking.");

    const active = await activatePartnership(asSupabase(client), prospect.id);
    expect(active.stage).toBe("active_partner");

    const closed = await closePartnership(asSupabase(client), prospect.id, "Pilot period ended, converted to standing partnership.");
    expect(closed.stage).toBe("closed");

    global.fetch = originalFetch;
  });

  it("archive and do-not-contact are reachable from an early stage without ever having generated a draft", async () => {
    const client = buildClient();
    const { prospect: p1 } = await createPartnership(asSupabase(client), newProspect());
    const archived = await archivePartnership(asSupabase(client), p1.id, "Not a fit after further research.");
    expect(archived.stage).toBe("archived");

    const { prospect: p2 } = await createPartnership(asSupabase(client), newProspect({ organizationName: "Another Org" }));
    const dnc = await markPartnershipDoNotContact(asSupabase(client), p2.id, "Explicitly asked not to be contacted.");
    expect(dnc.stage).toBe("do_not_contact");
  });
});
