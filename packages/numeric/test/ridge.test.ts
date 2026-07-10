import { describe, expect, it } from 'vitest';
import {
  NotPositiveDefiniteError,
  choleskyDecompose,
  informationCoefficient,
  rSquared,
  ridgeFit,
  solveSpd,
  type DesignMatrix,
} from '@hft/numeric';

describe('cholesky', () => {
  it('matches the hand-computed factor of [[4,2],[2,3]]', () => {
    const l = choleskyDecompose(Float64Array.from([4, 2, 2, 3]), 2);
    expect(l[0]).toBeCloseTo(2, 12);
    expect(l[1]).toBeCloseTo(0, 12);
    expect(l[2]).toBeCloseTo(1, 12);
    expect(l[3]).toBeCloseTo(Math.SQRT2, 12);
  });

  it('solves the hand-computed system 4x+2y=10, 2x+3y=11', () => {
    const x = solveSpd(Float64Array.from([4, 2, 2, 3]), 2, Float64Array.from([10, 11]));
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBeCloseTo(3, 12);
  });

  it('rejects a matrix that is not positive definite', () => {
    expect(() => choleskyDecompose(Float64Array.from([1, 2, 2, 1]), 2)).toThrowError(NotPositiveDefiniteError);
  });
});

describe('ridge', () => {
  const design: DesignMatrix = { rows: 3, cols: 1, data: Float64Array.from([1, 2, 3]) };
  const y = Float64Array.from([2, 4, 6]);

  it('recovers the exact OLS solution when lambda is zero', () => {
    const fit = ridgeFit(design, y, 0, true);
    expect(fit.beta[0]).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(0, 12);
  });

  it('matches the hand-computed ridge solution at lambda = 1', () => {
    const fit = ridgeFit(design, y, 1, true);
    expect(fit.beta[0]).toBeCloseTo(4 / 3, 12);
    expect(fit.intercept).toBeCloseTo(4 / 3, 12);
  });

  it('shrinks the coefficient monotonically as lambda grows', () => {
    const b0 = ridgeFit(design, y, 0, true).beta[0];
    const b1 = ridgeFit(design, y, 1, true).beta[0];
    const b10 = ridgeFit(design, y, 10, true).beta[0];
    expect(b0).toBeGreaterThan(b1);
    expect(b1).toBeGreaterThan(b10);
    expect(b10).toBeGreaterThan(0);
  });

  it('reports a worse conditioning estimate as lambda shrinks on a near-collinear design', () => {
    const rows = 50;
    const cols = 2;
    const data = new Float64Array(rows * cols);
    const yy = new Float64Array(rows);
    for (let i = 0; i < rows; i++) {
      const x = i / rows;
      data[i * cols] = x;
      data[i * cols + 1] = x + 1e-7 * ((i % 3) - 1);
      yy[i] = 3 * x;
    }
    const collinear: DesignMatrix = { rows, cols, data };
    const tight = ridgeFit(collinear, yy, 1e-12, true);
    const loose = ridgeFit(collinear, yy, 1, true);
    expect(tight.conditionEstimate).toBeGreaterThan(loose.conditionEstimate);
    expect(loose.conditionEstimate).toBeLessThan(1e6);
  });

  it('scores a perfect fit at R^2 = 1 and IC = 1', () => {
    const fit = ridgeFit(design, y, 0, true);
    const yhat = Float64Array.from([2, 4, 6]);
    expect(rSquared(y, yhat)).toBeCloseTo(1, 12);
    expect(informationCoefficient(yhat, y)).toBeCloseTo(1, 12);
    expect(fit.lambda).toBe(0);
  });
});
