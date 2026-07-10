export type Predictor = (features: Float64Array) => Float64Array;

export interface LinearModelArtifact {
  readonly schemaVersion: number;
  readonly kind: 'linear';
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly lambda: number;
  readonly intercept: readonly number[];
  readonly weights: readonly number[];
}
