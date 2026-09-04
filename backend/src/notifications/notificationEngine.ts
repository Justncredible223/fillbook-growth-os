import type { NewNotification } from "./types";

const HIGH_SCORE_THRESHOLD = 75;

export interface NotificationEngineInput {
  failedSteps: Array<{ step: string; detail: string }>;
  newHighScoreOpportunities: Array<{ id: string; title: string; score: number }>;
  freshStrategyVersion: { version: number; actionableCount: number } | null;
  newSignificantExperiments: Array<{ id: string; hypothesis: string; interpretation: string }>;
}

/**
 * "Notify only for meaningful events ... avoid notification spam" (master
 * spec). Pure, testable: given already-fetched real data (the
 * repository's job, not this function's), decides exactly which
 * notifications to create. No step here ever fires for routine, expected
 * activity (a normal successful sync, a low-score opportunity, a
 * strategy version with nothing actionable) -- only for things worth
 * interrupting the owner about.
 */
export function decideNotifications(input: NotificationEngineInput): NewNotification[] {
  const notifications: NewNotification[] = [];

  for (const failure of input.failedSteps) {
    notifications.push({
      type: "platform_failure",
      title: `${failure.step} failed`,
      body: failure.detail,
      severity: "warning",
      relatedId: failure.step,
    });
  }

  for (const opp of input.newHighScoreOpportunities) {
    if (opp.score < HIGH_SCORE_THRESHOLD) continue;
    notifications.push({
      type: "high_value_opportunity",
      title: `High-value opportunity: ${opp.title}`,
      body: `Score ${opp.score.toFixed(0)} -- worth a look in Radar.`,
      severity: "info",
      relatedId: opp.id,
    });
  }

  if (input.freshStrategyVersion && input.freshStrategyVersion.actionableCount > 0) {
    notifications.push({
      type: "strategy_updated",
      title: `Strategy report v${input.freshStrategyVersion.version} ready`,
      body: `${input.freshStrategyVersion.actionableCount} actionable recommendation(s) -- check the Strategy tab.`,
      severity: "info",
      relatedId: `strategy-${input.freshStrategyVersion.version}`,
    });
  }

  for (const exp of input.newSignificantExperiments) {
    notifications.push({
      type: "experiment_significant",
      title: "Experiment reached a significant result",
      body: `"${exp.hypothesis}" -- ${exp.interpretation}`,
      severity: "info",
      relatedId: exp.id,
    });
  }

  return notifications;
}
