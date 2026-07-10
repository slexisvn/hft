import type { Liquidity, Side, Ticks } from './enums';
import type { Nanos } from './time';

export const SCHEMA_VERSION = 1;

export type ColumnType = 'ns' | 'i32' | 'f64' | 'u8' | 'str';

export interface ColumnSpec {
  readonly name: string;
  readonly type: ColumnType;
}

export interface TableSchema {
  readonly name: string;
  readonly version: number;
  readonly columns: readonly ColumnSpec[];
}

export interface FillRecord {
  readonly timestampNs: Nanos;
  readonly clientOrderId: string;
  readonly side: Side;
  readonly priceTicks: Ticks;
  readonly size: number;
  readonly queuePositionAtFill: number;
  readonly midTicksAtFill: number;
  readonly liquidity: Liquidity;
}

const FILL_COLUMNS: readonly ColumnSpec[] = Object.freeze([
  { name: 'timestamp_ns', type: 'ns' },
  { name: 'client_order_id', type: 'str' },
  { name: 'side', type: 'u8' },
  { name: 'price_ticks', type: 'i32' },
  { name: 'size', type: 'i32' },
  { name: 'queue_position_at_fill', type: 'f64' },
  { name: 'mid_ticks_at_fill', type: 'f64' },
  { name: 'liquidity', type: 'u8' },
] as const);

export const FILLS_SCHEMA: TableSchema = Object.freeze({
  name: 'fills',
  version: SCHEMA_VERSION,
  columns: FILL_COLUMNS,
});

export const LIVE_FILLS_SCHEMA: TableSchema = Object.freeze({
  name: 'live_fills',
  version: SCHEMA_VERSION,
  columns: FILL_COLUMNS,
});

export function fillRow(f: FillRecord): readonly (number | string)[] {
  return [
    f.timestampNs,
    f.clientOrderId,
    f.side,
    f.priceTicks,
    f.size,
    f.queuePositionAtFill,
    f.midTicksAtFill,
    f.liquidity,
  ];
}

export interface FeatureRecord {
  readonly timestampNs: Nanos;
  readonly midTicks: number;
  readonly microPriceTicks: number;
  readonly spreadTicks: number;
  readonly bidSize: number;
  readonly askSize: number;
  readonly depthImbalance: number;
  readonly ofi: number;
  readonly tradeSign: number;
}

export const FEATURES_SCHEMA: TableSchema = Object.freeze({
  name: 'features',
  version: SCHEMA_VERSION,
  columns: Object.freeze([
    { name: 'timestamp_ns', type: 'ns' },
    { name: 'mid_ticks', type: 'f64' },
    { name: 'micro_price_ticks', type: 'f64' },
    { name: 'spread_ticks', type: 'f64' },
    { name: 'bid_size', type: 'i32' },
    { name: 'ask_size', type: 'i32' },
    { name: 'depth_imbalance', type: 'f64' },
    { name: 'ofi', type: 'f64' },
    { name: 'trade_sign', type: 'f64' },
  ] as const),
});

export function featureRow(f: FeatureRecord): readonly (number | string)[] {
  return [
    f.timestampNs,
    f.midTicks,
    f.microPriceTicks,
    f.spreadTicks,
    f.bidSize,
    f.askSize,
    f.depthImbalance,
    f.ofi,
    f.tradeSign,
  ];
}

export interface MarkoutPoint {
  readonly horizonNs: Nanos;
  readonly meanTicks: number;
  readonly meanBps: number;
  readonly count: number;
}

export interface MetricsJson {
  readonly schemaVersion: number;
  readonly strategy: string;
  readonly markout: readonly MarkoutPoint[];
  readonly markoutVsFillPrice: readonly MarkoutPoint[];
  readonly effectiveSpreadTicksMean: number;
  readonly realizedSpreadTicksMean: number;
  readonly priceImprovementTicksMean: number;
  readonly fillRatio: number;
  readonly fillCount: number;
  readonly submissionCount: number;
  readonly inventoryMean: number;
  readonly inventoryMin: number;
  readonly inventoryMax: number;
  readonly inventoryEnd: number;
  readonly pnlTicks: number;
}

export function schemasEqual(a: TableSchema, b: TableSchema): boolean {
  if (a.version !== b.version) return false;
  if (a.columns.length !== b.columns.length) return false;
  for (let i = 0; i < a.columns.length; i++) {
    const ca = a.columns[i];
    const cb = b.columns[i];
    if (ca.name !== cb.name || ca.type !== cb.type) return false;
  }
  return true;
}
