import type { MetricsJson } from '@hft/contracts';
import { formatInteger, formatPercent, formatRatioValue, formatSignedTicks, formatTicks } from './format';

type NumericMetricKey = {
  [Key in keyof MetricsJson]: MetricsJson[Key] extends number ? Key : never;
}[keyof MetricsJson];

export interface KpiDef {
  readonly key: NumericMetricKey;
  readonly label: string;
  readonly format: (value: number) => string;
}

export const KPI_DEFS: readonly KpiDef[] = [
  { key: 'pnlTicks', label: 'PnL (ticks)', format: formatSignedTicks },
  { key: 'sharpePerStep', label: 'Sharpe / step', format: formatRatioValue },
  { key: 'sortinoPerStep', label: 'Sortino / step', format: formatRatioValue },
  { key: 'maxDrawdownTicks', label: 'Max drawdown (ticks)', format: formatTicks },
  { key: 'fillRatio', label: 'Fill ratio', format: formatPercent },
  { key: 'inventoryEnd', label: 'Inventory end', format: formatInteger },
];
