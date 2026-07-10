import { choleskyDecompose, choleskySolve, conditionEstimate } from './cholesky';

export interface RidgeFit {
  readonly beta: Float64Array;
  readonly intercept: number;
  readonly lambda: number;
  readonly conditionEstimate: number;
}

export interface DesignMatrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
}

export function gramMatrix(x: DesignMatrix): Float64Array {
  const { rows, cols, data } = x;
  const g = new Float64Array(cols * cols);
  for (let i = 0; i < rows; i++) {
    const base = i * cols;
    for (let a = 0; a < cols; a++) {
      const va = data[base + a];
      if (va === 0) continue;
      for (let b = 0; b <= a; b++) {
        g[a * cols + b] += va * data[base + b];
      }
    }
  }
  for (let a = 0; a < cols; a++) {
    for (let b = 0; b < a; b++) g[b * cols + a] = g[a * cols + b];
  }
  return g;
}

export function gramVector(x: DesignMatrix, y: Float64Array): Float64Array {
  const { rows, cols, data } = x;
  const v = new Float64Array(cols);
  for (let i = 0; i < rows; i++) {
    const base = i * cols;
    const yi = y[i];
    for (let a = 0; a < cols; a++) v[a] += data[base + a] * yi;
  }
  return v;
}

export function ridgeFit(x: DesignMatrix, y: Float64Array, lambda: number, fitIntercept: boolean): RidgeFit {
  if (x.rows !== y.length) throw new Error(`design has ${x.rows} rows but y has ${y.length}`);
  if (lambda < 0) throw new Error(`lambda must be non-negative, got ${lambda}`);

  const { rows, cols } = x;
  let centered = x;
  const means = new Float64Array(cols);
  let yMean = 0;

  if (fitIntercept) {
    const data = new Float64Array(rows * cols);
    data.set(x.data);
    for (let a = 0; a < cols; a++) {
      let s = 0;
      for (let i = 0; i < rows; i++) s += data[i * cols + a];
      means[a] = s / rows;
    }
    for (let i = 0; i < rows; i++) {
      for (let a = 0; a < cols; a++) data[i * cols + a] -= means[a];
    }
    let sy = 0;
    for (let i = 0; i < rows; i++) sy += y[i];
    yMean = sy / rows;
    const yc = new Float64Array(rows);
    for (let i = 0; i < rows; i++) yc[i] = y[i] - yMean;
    centered = { rows, cols, data };
    y = yc;
  }

  const g = gramMatrix(centered);
  for (let a = 0; a < cols; a++) g[a * cols + a] += lambda;
  const rhs = gramVector(centered, y);
  const l = choleskyDecompose(g, cols);
  const beta = choleskySolve(l, cols, rhs);

  let intercept = 0;
  if (fitIntercept) {
    intercept = yMean;
    for (let a = 0; a < cols; a++) intercept -= beta[a] * means[a];
  }

  return { beta, intercept, lambda, conditionEstimate: conditionEstimate(l, cols) };
}

export function predict(x: DesignMatrix, beta: Float64Array, intercept: number, out: Float64Array): Float64Array {
  const { rows, cols, data } = x;
  for (let i = 0; i < rows; i++) {
    let s = intercept;
    const base = i * cols;
    for (let a = 0; a < cols; a++) s += data[base + a] * beta[a];
    out[i] = s;
  }
  return out;
}
