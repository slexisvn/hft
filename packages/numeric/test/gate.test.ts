import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMOTION_THRESHOLDS,
  evaluatePromotionGate,
  expectedMaxStandardNormal,
  informationCoefficientTStat,
  inverseNormalCdf,
} from '@hft/numeric';

describe('inverseNormalCdf', () => {
  it('inverts standard normal quantiles', () => {
    expect(inverseNormalCdf(0.5)).toBeCloseTo(0, 8);
    expect(inverseNormalCdf(0.975)).toBeCloseTo(1.959963985, 6);
    expect(inverseNormalCdf(0.025)).toBeCloseTo(-1.959963985, 6);
    expect(inverseNormalCdf(0.95)).toBeCloseTo(1.644853627, 6);
  });

  it('returns NaN outside the open unit interval', () => {
    expect(Number.isNaN(inverseNormalCdf(0))).toBe(true);
    expect(Number.isNaN(inverseNormalCdf(1))).toBe(true);
    expect(Number.isNaN(inverseNormalCdf(-0.1))).toBe(true);
  });
});

describe('informationCoefficientTStat', () => {
  it('scales with sqrt(n)', () => {
    const small = informationCoefficientTStat(0.2, 26);
    const large = informationCoefficientTStat(0.2, 101);
    expect(large).toBeGreaterThan(small);
    expect(small).toBeCloseTo(0.2 * Math.sqrt(24 / (1 - 0.04)), 8);
  });

  it('is zero for degenerate inputs', () => {
    expect(informationCoefficientTStat(0.5, 2)).toBe(0);
    expect(informationCoefficientTStat(1, 100)).toBe(0);
  });
});

describe('expectedMaxStandardNormal', () => {
  it('is zero or negative for a single trial and grows with the number of trials', () => {
    expect(expectedMaxStandardNormal(1)).toBe(0);
    expect(expectedMaxStandardNormal(0)).toBe(0);
    const few = expectedMaxStandardNormal(5);
    const many = expectedMaxStandardNormal(100);
    expect(few).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(few);
  });
});

describe('evaluatePromotionGate', () => {
  it('passes a significant single-trial model under the defaults', () => {
    const evaluation = evaluatePromotionGate(
      { outOfSampleIc: 0.3, outOfSampleR2: 0.05, icTStat: informationCoefficientTStat(0.3, 200), selectionTrials: 1 },
      DEFAULT_PROMOTION_THRESHOLDS,
    );
    expect(evaluation.selectionHaircut).toBe(0);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.reasons).toEqual([]);
  });

  it('rejects a negative-IC model', () => {
    const evaluation = evaluatePromotionGate(
      { outOfSampleIc: -0.1, outOfSampleR2: -0.2, icTStat: informationCoefficientTStat(-0.1, 200), selectionTrials: 1 },
      DEFAULT_PROMOTION_THRESHOLDS,
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.reasons.length).toBeGreaterThan(0);
  });

  it('deflates the t-stat for multiple lambda trials', () => {
    const icTStat = informationCoefficientTStat(0.14, 200);
    const single = evaluatePromotionGate(
      { outOfSampleIc: 0.14, outOfSampleR2: 0.01, icTStat, selectionTrials: 1 },
      DEFAULT_PROMOTION_THRESHOLDS,
    );
    const swept = evaluatePromotionGate(
      { outOfSampleIc: 0.14, outOfSampleR2: 0.01, icTStat, selectionTrials: 50 },
      DEFAULT_PROMOTION_THRESHOLDS,
    );
    expect(swept.deflatedIcTStat).toBeLessThan(single.deflatedIcTStat);
    expect(single.passed).toBe(true);
    expect(swept.passed).toBe(false);
  });

  it('enforces the positive-R2 requirement only when configured', () => {
    const input = { outOfSampleIc: 0.4, outOfSampleR2: -0.01, icTStat: informationCoefficientTStat(0.4, 200), selectionTrials: 1 };
    expect(evaluatePromotionGate(input, DEFAULT_PROMOTION_THRESHOLDS).passed).toBe(true);
    expect(
      evaluatePromotionGate(input, { minOutOfSampleIc: 0, minIcTStat: 1.645, requirePositiveR2: true }).passed,
    ).toBe(false);
  });
});
