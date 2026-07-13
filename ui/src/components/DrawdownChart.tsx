import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildEquitySeries } from '../lib/equity';
import { formatTicks } from '../lib/format';
import type { TableRow } from '../lib/table';
import { Panel } from './Panel';
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipProps } from './chartTheme';

export interface DrawdownChartProps {
  readonly fills: readonly TableRow[];
}

export function DrawdownChart({ fills }: DrawdownChartProps): JSX.Element {
  const data = buildEquitySeries(fills);
  return (
    <Panel title="Drawdown" caption="underwater from running peak equity">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...chartGridProps} />
          <XAxis dataKey="fill" {...chartAxisProps} />
          <YAxis {...chartAxisProps} tickFormatter={formatTicks} width={64} />
          <Tooltip {...chartTooltipProps} formatter={(value: number) => formatTicks(value)} />
          <Area
            type="monotone"
            dataKey="drawdownTicks"
            name="drawdown (ticks)"
            stroke="var(--series-loss)"
            fill="var(--series-loss)"
            fillOpacity={0.2}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}
