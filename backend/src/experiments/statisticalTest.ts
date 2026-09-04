/**
 * Two-proportion z-test -- the standard test for "did the pass rate
 * change between two periods," which is exactly what an Experiment here
 * compares (see experimentEngine.ts). Pure math, no I/O, so it's testable
 * against known textbook values independent of any Supabase query.
 */
export interface ProportionSample {
  successes: number;
  total: number;
}

export interface TestResult {
  controlRate: number | null;
  treatmentRate: number | null;
  /** Positive means treatment outperformed control. Null when either sample is empty. */
  absoluteDifference: number | null;
  zScore: number | null;
  /** Two-tailed p-value from the standard normal distribution. Null when untestable. */
  pValue: number | null;
  /** True only when both samples clear MIN_SAMPLE_SIZE and p < 0.05 -- never claims significance on a thin sample. */
  isSignificant: boolean;
  insufficientSample: boolean;
}

export const MIN_SAMPLE_SIZE = 5;
const SIGNIFICANCE_THRESHOLD = 0.05;

function rate(sample: ProportionSample): number | null {
  return sample.total === 0 ? null : sample.successes / sample.total;
}

/** Standard normal CDF via the Abramowitz-Stegun approximation -- no external stats library needed for one well-known formula. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) prob = 1 - prob;
  return prob;
}

export function twoProportionZTest(control: ProportionSample, treatment: ProportionSample): TestResult {
  const controlRate = rate(control);
  const treatmentRate = rate(treatment);
  const insufficientSample = control.total < MIN_SAMPLE_SIZE || treatment.total < MIN_SAMPLE_SIZE;

  if (controlRate === null || treatmentRate === null) {
    return {
      controlRate,
      treatmentRate,
      absoluteDifference: null,
      zScore: null,
      pValue: null,
      isSignificant: false,
      insufficientSample: true,
    };
  }

  const absoluteDifference = treatmentRate - controlRate;
  const pooledSuccesses = control.successes + treatment.successes;
  const pooledTotal = control.total + treatment.total;
  const pooledRate = pooledSuccesses / pooledTotal;
  const standardError = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / control.total + 1 / treatment.total));

  let zScore: number | null = null;
  let pValue: number | null = null;
  if (standardError > 0) {
    zScore = absoluteDifference / standardError;
    pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  }

  const isSignificant = !insufficientSample && pValue !== null && pValue < SIGNIFICANCE_THRESHOLD;

  return { controlRate, treatmentRate, absoluteDifference, zScore, pValue, isSignificant, insufficientSample };
}
