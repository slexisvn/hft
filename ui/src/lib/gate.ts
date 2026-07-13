import type { ModelProvenance } from '@hft/contracts';
import { DEFAULT_PROMOTION_THRESHOLDS, evaluatePromotionGate } from '@hft/numeric/gate';

export const GATE_MIN_IC_T_STAT = DEFAULT_PROMOTION_THRESHOLDS.minIcTStat;

export interface GateStatus {
  readonly passed: boolean;
  readonly deflatedIcTStat: number;
  readonly reasons: readonly string[];
}

export function evaluateGate(provenance: ModelProvenance): GateStatus {
  const result = evaluatePromotionGate(
    {
      outOfSampleIc: provenance.outOfSampleIc,
      outOfSampleR2: provenance.outOfSampleR2,
      icTStat: provenance.icTStat,
      selectionTrials: provenance.selectionTrials,
    },
    DEFAULT_PROMOTION_THRESHOLDS,
  );
  return { passed: result.passed, deflatedIcTStat: result.deflatedIcTStat, reasons: result.reasons };
}
