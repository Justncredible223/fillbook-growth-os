import { describe, it, expect } from "vitest";
import { FakeSupabaseClient, asSupabase } from "./helpers/fakeSupabase";
import { NotificationCollectionError, collectNotificationInputs } from "../src/notifications/supabaseNotificationRepository";
import { runStep } from "../api/daily-pipeline";

const since = "2026-09-03T12:00:00.000Z";

function healthyClient() {
  return new FakeSupabaseClient({
    notifications: [{ id: "n1", related_id: "opp-already", created_at: "2026-09-04T01:00:00.000Z" }],
    opportunities: [
      { id: "opp-already", title: "Already notified", score: 90, created_at: "2026-09-04T01:00:00.000Z" },
      { id: "opp-new", title: "Brand new", score: 80, created_at: "2026-09-04T02:00:00.000Z" },
      { id: "opp-low", title: "Low score", score: 40, created_at: "2026-09-04T02:00:00.000Z" },
    ],
    strategy_versions: [
      { id: "s1", version: 3, generated_at: "2026-09-04T03:00:00.000Z", topics_to_increase: [{}], topics_to_decrease: [], content_to_retire: [{}, {}], formats_to_test: [] },
      { id: "s0", version: 2, generated_at: "2026-09-01T03:00:00.000Z", topics_to_increase: [], topics_to_decrease: [], content_to_retire: [], formats_to_test: [] },
    ],
    experiments: [
      { id: "exp-sig", hypothesis: "Hooks", result: { isSignificant: true, computedAt: "2026-09-04T04:00:00.000Z", interpretation: "Improved." } },
      { id: "exp-old", hypothesis: "Old", result: { isSignificant: true, computedAt: "2026-08-01T04:00:00.000Z", interpretation: "Old." } },
      { id: "exp-none", hypothesis: "None", result: null },
    ],
  });
}

describe("collectNotificationInputs", () => {
  it("assembles inputs from all four reads and de-duplicates against existing notifications", async () => {
    const inputs = await collectNotificationInputs(asSupabase(healthyClient()), [{ step: "auto_draft", detail: "boom" }], since);

    expect(inputs.failedSteps).toEqual([{ step: "auto_draft", detail: "boom" }]);
    expect(inputs.newHighScoreOpportunities).toEqual([{ id: "opp-new", title: "Brand new", score: 80, created_at: "2026-09-04T02:00:00.000Z" }]);
    expect(inputs.freshStrategyVersion).toEqual({ version: 3, actionableCount: 3 });
    expect(inputs.newSignificantExperiments).toEqual([{ id: "exp-sig", hypothesis: "Hooks", interpretation: "Improved." }]);
  });

  describe("a failed read throws instead of degrading to 'nothing new'", () => {
    const cases: Array<{ table: string; query: string }> = [
      { table: "notifications", query: "existing notifications" },
      { table: "opportunities", query: "new high-score opportunities" },
      { table: "strategy_versions", query: "latest strategy version" },
      { table: "experiments", query: "experiments with results" },
    ];

    for (const { table, query } of cases) {
      it(`${table} failure -> NotificationCollectionError naming "${query}"`, async () => {
        const client = healthyClient();
        client.failTable(table, { message: `${table} is unavailable` });

        const promise = collectNotificationInputs(asSupabase(client), [], since);

        await expect(promise).rejects.toBeInstanceOf(NotificationCollectionError);
        await expect(promise).rejects.toThrow(`notification input query "${query}" failed: ${table} is unavailable`);
      });
    }

    it("the daily pipeline's runStep records the failure as ok=false with the specific message (never a silent success)", async () => {
      const client = healthyClient();
      client.failTable("opportunities", { message: "timeout" });

      const step = await runStep("notifications", async () => {
        await collectNotificationInputs(asSupabase(client), [], since);
        return "0 created";
      });

      expect(step).toEqual({
        step: "notifications",
        ok: false,
        detail: 'notification input query "new high-score opportunities" failed: timeout',
      });
    });
  });
});
