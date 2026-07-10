import { describe, expect, it } from 'vitest';
import { predict, ridgeFit, splitRows, standardize, toRawSpace, type DesignMatrix } from '@hft/numeric';

const design: DesignMatrix = { rows: 4, cols: 2, data: Float64Array.from([1, 10, 2, 20, 3, 30, 4, 45]) };
const y = Float64Array.from([1, 2, 3, 4]);

describe('standardize', () => {
  it('centres each column and scales it to unit sample deviation', () => {
    const { design: z } = standardize(design);
    for (let c = 0; c < 2; c++) {
      let sum = 0;
      let ss = 0;
      for (let i = 0; i < 4; i++) sum += z.data[i * 2 + c];
      const mean = sum / 4;
      for (let i = 0; i < 4; i++) ss += (z.data[i * 2 + c] - mean) ** 2;
      expect(mean).toBeCloseTo(0, 12);
      expect(Math.sqrt(ss / 3)).toBeCloseTo(1, 12);
    }
  });

  it('leaves a constant column alone rather than dividing by zero', () => {
    const constant: DesignMatrix = { rows: 3, cols: 1, data: Float64Array.from([5, 5, 5]) };
    const { design: z, standardization } = standardize(constant);
    expect(standardization.scale[0]).toBe(1);
    expect(Array.from(z.data)).toEqual([0, 0, 0]);
  });

  it('a model fitted on standardized columns predicts identically once mapped back to raw space', () => {
    const { design: z, standardization } = standardize(design);
    const fit = ridgeFit(z, y, 0.5, true);
    const raw = toRawSpace(fit.beta, fit.intercept, standardization);

    const onStandardized = predict(z, fit.beta, fit.intercept, new Float64Array(4));
    const onRaw = predict(design, raw.weights, raw.intercept, new Float64Array(4));
    for (let i = 0; i < 4; i++) expect(onRaw[i]).toBeCloseTo(onStandardized[i], 10);
  });

  it('improves the conditioning of a badly scaled design', () => {
    const scaled: DesignMatrix = { rows: 4, cols: 2, data: Float64Array.from([1, 1e6, 2, 2e6, 3, 3.1e6, 4, 4e6]) };
    const bare = ridgeFit(scaled, y, 1e-6, true);
    const std = ridgeFit(standardize(scaled).design, y, 1e-6, true);
    expect(std.conditionEstimate).toBeLessThan(bare.conditionEstimate);
  });
});

describe('splitRows', () => {
  it('splits chronologically, never shuffling a time series', () => {
    const s = splitRows(design, y, 0.5);
    expect(s.trainX.rows).toBe(2);
    expect(s.testX.rows).toBe(2);
    expect(Array.from(s.trainY)).toEqual([1, 2]);
    expect(Array.from(s.testY)).toEqual([3, 4]);
    expect(Array.from(s.testX.data)).toEqual([3, 30, 4, 45]);
  });

  it('refuses a fraction that leaves no training or no test rows', () => {
    expect(() => splitRows(design, y, 0.01)).toThrowError(/leaves 0 training rows/);
    expect(() => splitRows(design, y, 1)).toThrowError(/training rows/);
  });
});
