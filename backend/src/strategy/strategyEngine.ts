import type {
  ExperimentSuggestion,
  FormatRecommendation,
  StrategyEngineInput,
  StrategyRecommendation,
  TopicRecommendation,
  TopicStats,
} from "./types";

/** Below this many campaigns/assets, a pass rate is noise, not signal --
 * never recommend increasing or decreasing based on 1 data point. */
const MIN_SAMPLE_SIZE = 3;
const INCREASE_PASS_RATE_THRESHOLD = 0.7;
const DECREASE_PASS_RATE_THRESHOLD = 0.4;
const STALE_CREATOR_DAYS = 30;

function passRate(passes: number, fails: number): number | null {
  const total = passes + fails;
  return total === 0 ? null : passes / total;
}

function topicSampleSize(t: TopicStats): number {
  return t.campaignCount;
}

/**
 * Pure recommendation logic -- no I/O, fully unit-testable. Given
 * pre-aggregated stats (the repository's job, not this function's), scores
 * each topic/format against fixed thresholds and produces the same
 * report structure the master spec's Strategy Evolution calls for,
 * built from proxies this schema actually has (see types.ts's kdoc for
 * which real-world inputs aren't available yet).
 */
export function generateStrategy(input: StrategyEngineInput): StrategyRecommendation {
  const topicsToIncrease: TopicRecommendation[] = [];
  const topicsToDecrease: TopicRecommendation[] = [];
  const contentToRetire: TopicRecommendation[] = [];
  let scoredTopicCount = 0;

  for (const t of input.topicStats) {
    if (topicSampleSize(t) < MIN_SAMPLE_SIZE) continue;
    const rate = passRate(t.totalContentScorePasses, t.totalContentScoreFails);
    if (rate === null) continue;
    scoredTopicCount++;

    if (rate >= INCREASE_PASS_RATE_THRESHOLD && t.reachedReadyForOwnerCount > 0) {
      topicsToIncrease.push({
        topic: t.topic,
        reason: `${(rate * 100).toFixed(0)}% review pass rate across ${t.campaignCount} campaigns, ${t.reachedReadyForOwnerCount} reached ready-for-owner.`,
      });
    } else if (rate < DECREASE_PASS_RATE_THRESHOLD) {
      topicsToDecrease.push({
        topic: t.topic,
        reason: `Only ${(rate * 100).toFixed(0)}% review pass rate across ${t.campaignCount} campaigns.`,
      });
      if (t.reachedReadyForOwnerCount === 0) {
        contentToRetire.push({
          topic: t.topic,
          reason: `${t.campaignCount} attempts, none reached ready-for-owner -- this angle isn't working.`,
        });
      }
    }
  }

  const formatsToTest: FormatRecommendation[] = [];
  for (const f of input.formatStats) {
    if (f.assetCount < MIN_SAMPLE_SIZE) continue;
    const rate = passRate(f.totalContentScorePasses, f.totalContentScoreFails);
    if (rate !== null && rate >= INCREASE_PASS_RATE_THRESHOLD) {
      formatsToTest.push({
        platform: f.platform,
        assetType: f.assetType,
        reason: `${(rate * 100).toFixed(0)}% pass rate across ${f.assetCount} assets -- worth more volume here.`,
      });
    }
  }

  const seoOpportunities = input.seoCandidates.filter((c) => !c.hasExistingOpportunity && c.velocity > 0);

  const creatorOpportunities = input.creatorCandidates.filter(
    (c) => c.daysSinceLastInteraction === null || c.daysSinceLastInteraction >= STALE_CREATOR_DAYS,
  );

  const experimentsToRun: ExperimentSuggestion[] = [];
  if (topicsToIncrease.length > 0) {
    experimentsToRun.push({
      hypothesis: `Doubling down on "${topicsToIncrease[0]!.topic}"-style topics increases the ready-for-owner rate further.`,
      rationale: topicsToIncrease[0]!.reason,
    });
  }
  if (formatsToTest.length > 0) {
    experimentsToRun.push({
      hypothesis: `More ${formatsToTest[0]!.assetType} content on ${formatsToTest[0]!.platform} sustains the same pass rate at higher volume.`,
      rationale: formatsToTest[0]!.reason,
    });
  }

  const lowConfidence = scoredTopicCount < 2;

  const summaryParts: string[] = [];
  if (lowConfidence) {
    summaryParts.push(
      `Not enough completed campaigns yet for a confident read (${scoredTopicCount} topic(s) had ${MIN_SAMPLE_SIZE}+ campaigns) -- treat this as directional, not settled.`,
    );
  }
  summaryParts.push(`${topicsToIncrease.length} topic(s) to double down on, ${topicsToDecrease.length} to pull back on.`);
  if (contentToRetire.length > 0) summaryParts.push(`${contentToRetire.length} angle(s) worth retiring entirely.`);
  if (seoOpportunities.length > 0) summaryParts.push(`${seoOpportunities.length} rising search topic(s) with no opportunity yet.`);
  if (creatorOpportunities.length > 0) summaryParts.push(`${creatorOpportunities.length} creator relationship(s) gone quiet.`);

  return {
    topicsToIncrease,
    topicsToDecrease,
    contentToRetire,
    formatsToTest,
    seoOpportunities,
    creatorOpportunities,
    experimentsToRun,
    summary: summaryParts.join(" "),
    lowConfidence,
  };
}
