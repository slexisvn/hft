import { describe, expect, it } from 'vitest';
import { purgedKFold, selectLambdaByCv, type DesignMatrix } from '@hft/numeric';

describe('purgedKFold', () => {
  it('partitions the rows into contiguous test blocks that cover everything', () => {
    const folds = purgedKFold(10, 5, 0);
    expect(folds.length).toBe(5);
    const allTest = folds.flatMap((f) => f.test);
    expect([...allTest].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('embargoes rows on both sides of the test block out of the training set', () => {
    const [, second] = purgedKFold(12, 3, 1);
    expect(second.test).toEqual([4, 5, 6, 7]);
    expect(second.train).not.toContain(3);
    expect(second.train).not.toContain(8);
    expect(second.train).toContain(2);
    expect(second.train).toContain(9);
  });

  it('rejects fewer than two folds', () => {
    expect(() => purgedKFold(10, 1, 0)).toThrowError(/at least 2 folds/);
  });
});

describe('selectLambdaByCv', () => {
  it('prefers stronger regularisation when the signal is pure noise', () => {
    const rows = 200;
    const cols = 6;
    const data = new Float64Array(rows * cols);
    const y = new Float64Array(rows);
    let s = 12345;
    const rand = (): number => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s / 0x7fffffff - 0.5;
    };
    for (let i = 0; i < rows; i++) {
      for (let c = 0; c < cols; c++) data[i * cols + c] = rand();
      y[i] = rand();
    }
    const x: DesignMatrix = { rows, cols, data };
    const folds = purgedKFold(rows, 5, 2);
    const selection = selectLambdaByCv(x, y, [0.001, 1, 1000], folds, true);
    expect(selection.scores.length).toBe(3);
    expect(selection.best).toBe(1000);
  });
});
