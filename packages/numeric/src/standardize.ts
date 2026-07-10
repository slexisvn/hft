import type { DesignMatrix } from './ridge';

export interface Standardization {
  readonly mean: Float64Array;
  readonly scale: Float64Array;
}

export interface StandardizedDesign {
  readonly design: DesignMatrix;
  readonly standardization: Standardization;
}

export function standardize(x: DesignMatrix): StandardizedDesign {
  const { rows, cols } = x;
  const mean = new Float64Array(cols);
  const scale = new Float64Array(cols);

  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let i = 0; i < rows; i++) s += x.data[i * cols + c];
    mean[c] = s / rows;
  }
  for (let c = 0; c < cols; c++) {
    let ss = 0;
    for (let i = 0; i < rows; i++) {
      const d = x.data[i * cols + c] - mean[c];
      ss += d * d;
    }
    const sd = Math.sqrt(ss / Math.max(1, rows - 1));
    scale[c] = sd > 0 ? sd : 1;
  }

  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < cols; c++) {
      data[i * cols + c] = (x.data[i * cols + c] - mean[c]) / scale[c];
    }
  }
  return { design: { rows, cols, data }, standardization: { mean, scale } };
}

export function applyStandardization(x: DesignMatrix, s: Standardization): DesignMatrix {
  const { rows, cols } = x;
  const data = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < cols; c++) {
      data[i * cols + c] = (x.data[i * cols + c] - s.mean[c]) / s.scale[c];
    }
  }
  return { rows, cols, data };
}

export interface RawSpaceModel {
  readonly weights: Float64Array;
  readonly intercept: number;
}

export function toRawSpace(betaStandardized: Float64Array, interceptStandardized: number, s: Standardization): RawSpaceModel {
  const cols = betaStandardized.length;
  const weights = new Float64Array(cols);
  let intercept = interceptStandardized;
  for (let c = 0; c < cols; c++) {
    weights[c] = betaStandardized[c] / s.scale[c];
    intercept -= weights[c] * s.mean[c];
  }
  return { weights, intercept };
}

export function splitRows(x: DesignMatrix, y: Float64Array, fraction: number): {
  trainX: DesignMatrix;
  trainY: Float64Array;
  testX: DesignMatrix;
  testY: Float64Array;
} {
  const nTrain = Math.floor(x.rows * fraction);
  if (nTrain < 1 || nTrain >= x.rows) {
    throw new Error(`train fraction ${fraction} leaves ${nTrain} training rows of ${x.rows}`);
  }
  const cols = x.cols;
  const nTest = x.rows - nTrain;
  return {
    trainX: { rows: nTrain, cols, data: x.data.slice(0, nTrain * cols) },
    trainY: y.slice(0, nTrain),
    testX: { rows: nTest, cols, data: x.data.slice(nTrain * cols) },
    testY: y.slice(nTrain),
  };
}
