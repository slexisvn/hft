import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildEquitySeries } from '../lib/equity';
import { formatTicks } from '../lib/format';
import type { TableRow } from '../lib/table';
import { Panel } from './Panel';
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipProps } from './chartTheme';

export interface EquityCurveProps {
  readonly fills: readonly TableRow[];
}

export function EquityCurve({ fills }: EquityCurveProps): JSX.Element {
  const data = buildEquitySeries(fills);
  return (
    <Panel title="Cumulative PnL" caption="mark-to-market per fill, gross of fees">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...chartGridProps} />
          <XAxis dataKey="fill" {...chartAxisProps} />
          <YAxis {...chartAxisProps} tickFormatter={formatTicks} width={64} />
          <Tooltip {...chartTooltipProps} formatter={(value: number) => formatTicks(value)} />
          <Line
            type="monotone"
            dataKey="equityTicks"
            name="equity (ticks)"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}
