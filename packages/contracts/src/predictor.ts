export type Predictor = (features: Float64Array) => Float64Array;

export interface ModelProvenance {
  readonly generatedAt: string;
  readonly datasetHash: string;
  readonly configHash: string;
  readonly rows: number;
  readonly trainRows: number;
  readonly testRows: number;
  readonly horizonSteps: number;
  readonly target: string;
  readonly standardized: boolean;
  readonly lambda: number;
  readonly lambdaSource: string;
  readonly conditionEstimate: number;
  readonly inSampleIc: number;
  readonly outOfSampleIc: number;
  readonly inSampleR2: number;
  readonly outOfSampleR2: number;
  readonly icTStat: number;
  readonly deflatedIcTStat: number;
  readonly selectionTrials: number;
}

export interface LinearModelArtifact {
  readonly schemaVersion: number;
  readonly kind: 'linear';
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly lambda: number;
  readonly intercept: readonly number[];
  readonly weights: readonly number[];
  readonly provenance?: ModelProvenance;
}
