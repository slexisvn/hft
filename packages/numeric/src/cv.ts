import { ridgeFit, predict, type DesignMatrix } from './ridge';
import { standardize, applyStandardization, type Standardization } from './standardize';
import { rSquared } from './stats';

export interface Fold {
  readonly train: readonly number[];
  readonly test: readonly number[];
}

export function purgedKFold(n: number, folds: number, embargo: number): Fold[] {
  if (folds < 2) throw new Error(`purgedKFold needs at least 2 folds, got ${folds}`);
  if (embargo < 0) throw new Error(`embargo must be non-negative, got ${embargo}`);
  const out: Fold[] = [];
  const size = Math.floor(n / folds);
  for (let f = 0; f < folds; f++) {
    const start = f * size;
    const end = f === folds - 1 ? n : start + size;
    const lo = start - embargo;
    const hi = end + embargo;
    const test: number[] = [];
    const train: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i >= start && i < end) test.push(i);
      else if (i < lo || i >= hi) train.push(i);
    }
    out.push({ train, test });
  }
  return out;
}

function identity(cols: number): Standardization {
  return { mean: new Float64Array(cols), scale: new Float64Array(cols).fill(1) };
}

function subMatrix(x: DesignMatrix, rows: readonly number[]): DesignMatrix {
  const data = new Float64Array(rows.length * x.cols);
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r] * x.cols;
    for (let c = 0; c < x.cols; c++) data[r * x.cols + c] = x.data[src + c];
  }
  return { rows: rows.length, cols: x.cols, data };
}

function subVector(y: Float64Array, rows: readonly number[]): Float64Array {
  const out = new Float64Array(rows.length);
  for (let r = 0; r < rows.length; r++) out[r] = y[rows[r]];
  return out;
}

export interface LambdaScore {
  readonly lambda: number;
  readonly meanR2: number;
}

export interface LambdaSelection {
  readonly best: number;
  readonly scores: readonly LambdaScore[];
}

export function selectLambdaByCv(
  x: DesignMatrix,
  y: Float64Array,
  lambdas: readonly number[],
  folds: readonly Fold[],
  standardizeFeatures: boolean,
): LambdaSelection {
  const scores: LambdaScore[] = [];
  let best = lambdas[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const lambda of lambdas) {
    let sum = 0;
    let count = 0;
    for (const fold of folds) {
      if (fold.train.length <= x.cols + 1 || fold.test.length === 0) continue;
      const trainX = subMatrix(x, fold.train);
      const trainY = subVector(y, fold.train);
      const prep = standardizeFeatures
        ? standardize(trainX)
        : { design: trainX, standardization: identity(x.cols) };
      const fit = ridgeFit(prep.design, trainY, lambda, true);
      const rawTestX = subMatrix(x, fold.test);
      const testX = standardizeFeatures ? applyStandardization(rawTestX, prep.standardization) : rawTestX;
      const yhat = predict(testX, fit.beta, fit.intercept, new Float64Array(fold.test.length));
      sum += rSquared(subVector(y, fold.test), yhat);
      count++;
    }
    const meanR2 = count === 0 ? Number.NEGATIVE_INFINITY : sum / count;
    scores.push({ lambda, meanR2 });
    if (meanR2 > bestScore) {
      bestScore = meanR2;
      best = lambda;
    }
  }
  return { best, scores };
}
