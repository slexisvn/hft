import type { MetricsJson } from '@hft/contracts';
import { KPI_DEFS } from '../lib/kpi';

export interface KpiRowProps {
  readonly metrics: MetricsJson;
}

export function KpiRow({ metrics }: KpiRowProps): JSX.Element {
  return (
    <div className="kpi-row">
      {KPI_DEFS.map((def) => {
        const value = metrics[def.key];
        return (
          <div key={def.key} className="kpi-card" data-metric={def.key}>
            <span className="kpi-label">{def.label}</span>
            <span className={`kpi-value ${value < 0 ? 'is-negative' : 'is-positive'}`}>{def.format(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
