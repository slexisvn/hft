import type { Nanos } from './time';
import { SCHEMA_VERSION, type ColumnType, type TableSchema } from './schema';

export interface FeatureRecord {
  readonly timestampNs: Nanos;
  readonly midTicks: number;
  readonly microPriceTicks: number;
  readonly spreadTicks: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly depthImbalance: number;
  readonly ofi: number;
  readonly multiLevelOfi: number;
  readonly tradeSign: number;
}

export type FeatureRole = 'meta' | 'predictor';
export type FeatureSource = 'book' | 'trade';

export interface FeatureSpec {
  readonly name: string;
  readonly field: keyof FeatureRecord;
  readonly type: ColumnType;
  readonly role: FeatureRole;
  readonly source: FeatureSource;
}

export const FEATURE_SPECS = [
  { name: 'timestamp_ns', field: 'timestampNs', type: 'ns', role: 'meta', source: 'book' },
  { name: 'mid_ticks', field: 'midTicks', type: 'f64', role: 'meta', source: 'book' },
  { name: 'micro_price_ticks', field: 'microPriceTicks', type: 'f64', role: 'predictor', source: 'book' },
  { name: 'spread_ticks', field: 'spreadTicks', type: 'f64', role: 'predictor', source: 'book' },
  { name: 'bid_size', field: 'bidSize', type: 'i32', role: 'predictor', source: 'book' },
  { name: 'ask_size', field: 'askSize', type: 'i32', role: 'predictor', source: 'book' },
  { name: 'depth_imbalance', field: 'depthImbalance', type: 'f64', role: 'predictor', source: 'book' },
  { name: 'ofi', field: 'ofi', type: 'f64', role: 'predictor', source: 'book' },
  { name: 'multi_level_ofi', field: 'multiLevelOfi', type: 'f64', role: 'predictor', source: 'book' },
  { name: 'trade_sign', field: 'tradeSign', type: 'f64', role: 'predictor', source: 'trade' },
] as const satisfies readonly FeatureSpec[];

type PredictorSpec = Extract<(typeof FEATURE_SPECS)[number], { role: 'predictor' }>;
export type FeatureName = PredictorSpec['name'];

export const PREDICTOR_FEATURE_NAMES: readonly FeatureName[] = FEATURE_SPECS.filter(
  (s): s is PredictorSpec => s.role === 'predictor',
).map((s) => s.name);

export const FEATURE_SOURCE: Readonly<Record<FeatureName, FeatureSource>> = Object.freeze(
  Object.fromEntries(
    FEATURE_SPECS.filter((s): s is PredictorSpec => s.role === 'predictor').map((s) => [s.name, s.source]),
  ) as Record<FeatureName, FeatureSource>,
);

export const FEATURES_SCHEMA: TableSchema = Object.freeze({
  name: 'features',
  version: SCHEMA_VERSION,
  columns: Object.freeze(FEATURE_SPECS.map((s) => Object.freeze({ name: s.name, type: s.type }))),
});

export function featureRow(f: FeatureRecord): readonly (number | string)[] {
  return FEATURE_SPECS.map((s) => f[s.field]);
}

export const PREDICTOR_FIELDS: readonly (keyof FeatureRecord)[] = FEATURE_SPECS.filter(
  (s): s is PredictorSpec => s.role === 'predictor',
).map((s) => s.field);

export function assembleFeatureRecord(
  timestampNs: Nanos,
  midTicks: number,
  predictorValues: Float64Array,
): FeatureRecord {
  const rec: Record<string, number> = { timestampNs, midTicks };
  for (let i = 0; i < PREDICTOR_FIELDS.length; i++) rec[PREDICTOR_FIELDS[i]] = predictorValues[i];
  return rec as unknown as FeatureRecord;
}
