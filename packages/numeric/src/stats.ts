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

export function informationCoefficientTStat(ic: number, sampleSize: number): number {
  if (!(sampleSize > 2)) return 0;
  const denom = 1 - ic * ic;
  if (!(denom > 0)) return 0;
  return ic * Math.sqrt((sampleSize - 2) / denom);
}

const INV_NORM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
  2.506628277459239,
];
const INV_NORM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1,
];
const INV_NORM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
  2.938163982698783,
];
const INV_NORM_D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
const INV_NORM_LOW = 0.02425;

function invNormRationalTail(q: number): number {
  return (
    (((((INV_NORM_C[0] * q + INV_NORM_C[1]) * q + INV_NORM_C[2]) * q + INV_NORM_C[3]) * q + INV_NORM_C[4]) * q +
      INV_NORM_C[5]) /
    ((((INV_NORM_D[0] * q + INV_NORM_D[1]) * q + INV_NORM_D[2]) * q + INV_NORM_D[3]) * q + 1)
  );
}

export function inverseNormalCdf(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  if (p < INV_NORM_LOW) return invNormRationalTail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - INV_NORM_LOW) return -invNormRationalTail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((INV_NORM_A[0] * r + INV_NORM_A[1]) * r + INV_NORM_A[2]) * r + INV_NORM_A[3]) * r + INV_NORM_A[4]) * r +
      INV_NORM_A[5]) *
      q) /
    (((((INV_NORM_B[0] * r + INV_NORM_B[1]) * r + INV_NORM_B[2]) * r + INV_NORM_B[3]) * r + INV_NORM_B[4]) * r + 1)
  );
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
