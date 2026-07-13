import { inverseNormalCdf } from './stats';

export interface PromotionThresholds {
  readonly minOutOfSampleIc: number;
  readonly minIcTStat: number;
  readonly requirePositiveR2: boolean;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
  minOutOfSampleIc: 0,
  minIcTStat: 1.645,
  requirePositiveR2: false,
};

const EULER_MASCHERONI = 0.5772156649015329;

export function expectedMaxStandardNormal(trials: number): number {
  if (!(trials > 1)) return 0;
  const upper = inverseNormalCdf(1 - 1 / trials);
  const lower = inverseNormalCdf(1 - 1 / (trials * Math.E));
  return (1 - EULER_MASCHERONI) * upper + EULER_MASCHERONI * lower;
}

export interface PromotionInput {
  readonly outOfSampleIc: number;
  readonly outOfSampleR2: number;
  readonly icTStat: number;
  readonly selectionTrials: number;
}

export interface PromotionEvaluation {
  readonly passed: boolean;
  readonly selectionHaircut: number;
  readonly deflatedIcTStat: number;
  readonly reasons: readonly string[];
}

export function evaluatePromotionGate(input: PromotionInput, thresholds: PromotionThresholds): PromotionEvaluation {
  const selectionHaircut = expectedMaxStandardNormal(input.selectionTrials);
  const deflatedIcTStat = input.icTStat - selectionHaircut;
  const reasons: string[] = [];
  if (!(input.outOfSampleIc >= thresholds.minOutOfSampleIc)) {
    reasons.push(`out-of-sample IC ${input.outOfSampleIc.toFixed(6)} below minimum ${thresholds.minOutOfSampleIc}`);
  }
  if (!(deflatedIcTStat >= thresholds.minIcTStat)) {
    reasons.push(
      `selection-deflated IC t-stat ${deflatedIcTStat.toFixed(4)} below minimum ${thresholds.minIcTStat} ` +
        `(raw ${input.icTStat.toFixed(4)}, haircut ${selectionHaircut.toFixed(4)} over ${input.selectionTrials} trial(s))`,
    );
  }
  if (thresholds.requirePositiveR2 && !(input.outOfSampleR2 > 0)) {
    reasons.push(`out-of-sample R^2 ${input.outOfSampleR2.toFixed(6)} not positive`);
  }
  return { passed: reasons.length === 0, selectionHaircut, deflatedIcTStat, reasons };
}
