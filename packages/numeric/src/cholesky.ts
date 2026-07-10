export class NotPositiveDefiniteError extends Error {
  readonly pivot: number;
  constructor(pivot: number, value: number) {
    super(`matrix is not positive definite: pivot ${pivot} has value ${value}`);
    this.name = 'NotPositiveDefiniteError';
    this.pivot = pivot;
  }
}

export function choleskyDecompose(a: Float64Array, n: number): Float64Array {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i * n + j];
      for (let k = 0; k < j; k++) sum -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (!(sum > 0)) throw new NotPositiveDefiniteError(i, sum);
        l[i * n + j] = Math.sqrt(sum);
      } else {
        l[i * n + j] = sum / l[j * n + j];
      }
    }
  }
  return l;
}

export function choleskySolve(l: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= l[i * n + k] * y[k];
    y[i] = sum / l[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= l[k * n + i] * x[k];
    x[i] = sum / l[i * n + i];
  }
  return x;
}

export function solveSpd(a: Float64Array, n: number, b: Float64Array): Float64Array {
  return choleskySolve(choleskyDecompose(a, n), n, b);
}

export function conditionEstimate(l: Float64Array, n: number): number {
  let minDiag = Number.POSITIVE_INFINITY;
  let maxDiag = 0;
  for (let i = 0; i < n; i++) {
    const d = l[i * n + i];
    if (d < minDiag) minDiag = d;
    if (d > maxDiag) maxDiag = d;
  }
  if (minDiag === 0) return Number.POSITIVE_INFINITY;
  const ratio = maxDiag / minDiag;
  return ratio * ratio;
}
