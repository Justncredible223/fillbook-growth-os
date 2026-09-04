import { twoProportionZTest, type ProportionSample } from "./statisticalTest.js";
import type { ExperimentResult } from "./types";

/**
 * Turns the raw statistical test into the human-readable interpretation
 * an owner actually needs -- never claims a result means more than the
 * math supports. Pure, testable independent of any DB query.
 */
export function interpretExperiment(control: ProportionSample, treatment: ProportionSample, now: Date): ExperimentResult {
  const test = twoProportionZTest(control, treatment);

  let interpretation: string;
  if (test.insufficientSample) {
    interpretation = `Not enough data yet (control: ${control.total}, treatment: ${treatment.total} -- both need 5+). Keep running before drawing a conclusion.`;
  } else if (test.controlRate === null || test.treatmentRate === null || test.absoluteDifference === null) {
    interpretation = "Couldn't compute a result -- one of the periods had zero assets.";
  } else if (test.isSignificant) {
    const direction = test.absoluteDifference > 0 ? "improved" : "declined";
    interpretation = `Statistically significant: pass rate ${direction} from ${(test.controlRate * 100).toFixed(0)}% to ${(test.treatmentRate * 100).toFixed(0)}% (p=${test.pValue!.toFixed(3)}).`;
  } else {
    interpretation = `No statistically significant difference (${(test.controlRate * 100).toFixed(0)}% -> ${(test.treatmentRate * 100).toFixed(0)}%, p=${test.pValue?.toFixed(3) ?? "n/a"}) -- the change could be noise.`;
  }

  return {
    controlRate: test.controlRate,
    treatmentRate: test.treatmentRate,
    absoluteDifference: test.absoluteDifference,
    pValue: test.pValue,
    isSignificant: test.isSignificant,
    insufficientSample: test.insufficientSample,
    controlSampleSize: control.total,
    treatmentSampleSize: treatment.total,
    interpretation,
    computedAt: now.toISOString(),
  };
}
