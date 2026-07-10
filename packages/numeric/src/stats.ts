export function mean(x: Float64Array): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

export function variance(x: Float64Array): number {
  const n = x.length;
  if (n < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    s += d * d;
  }
  return s / (n - 1);
}

export function stddev(x: Float64Array): number {
  return Math.sqrt(variance(x));
}

export function covariance(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  if (n !== y.length || n < 2) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

export function correlation(x: Float64Array, y: Float64Array): number {
  const sx = stddev(x);
  const sy = stddev(y);
  if (!(sx > 0) || !(sy > 0)) return NaN;
  return covariance(x, y) / (sx * sy);
}

export function rSquared(actual: Float64Array, predicted: Float64Array): number {
  const n = actual.length;
  if (n === 0 || n !== predicted.length) return NaN;
  const m = mean(actual);
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const r = actual[i] - predicted[i];
    ssRes += r * r;
    const d = actual[i] - m;
    ssTot += d * d;
  }
  if (ssTot === 0) return NaN;
  return 1 - ssRes / ssTot;
}

export function informationCoefficient(predicted: Float64Array, realized: Float64Array): number {
  return correlation(predicted, realized);
}

export interface Descriptive {
  readonly count: number;
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
}

export function describe(x: Float64Array): Descriptive {
  const n = x.length;
  if (n === 0) return { count: 0, mean: NaN, stddev: NaN, min: NaN, max: NaN };
  let min = x[0];
  let max = x[0];
  for (let i = 1; i < n; i++) {
    if (x[i] < min) min = x[i];
    if (x[i] > max) max = x[i];
  }
  return { count: n, mean: mean(x), stddev: n > 1 ? stddev(x) : NaN, min, max };
}
