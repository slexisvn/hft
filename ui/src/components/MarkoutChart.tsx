import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MetricsJson } from '@hft/contracts';
import { formatHorizon, formatTicks } from '../lib/format';
import { Panel } from './Panel';
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipProps } from './chartTheme';

export interface MarkoutChartProps {
  readonly markout: MetricsJson['markout'];
}

export function MarkoutChart({ markout }: MarkoutChartProps): JSX.Element {
  const data = markout.map((point) => ({
    horizon: formatHorizon(point.horizonNs),
    meanTicks: point.meanTicks,
    count: point.count,
  }));
  return (
    <Panel title="Markout by horizon" caption="mean mid-price markout per fill horizon">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid {...chartGridProps} vertical={false} />
          <XAxis dataKey="horizon" {...chartAxisProps} />
          <YAxis {...chartAxisProps} tickFormatter={formatTicks} width={64} />
          <Tooltip
            {...chartTooltipProps}
            cursor={{ fill: 'var(--text-muted)', fillOpacity: 0.12 }}
            formatter={(value: number) => formatTicks(value)}
          />
          <Bar dataKey="meanTicks" name="markout (ticks)" isAnimationActive={false}>
            {data.map((point) => (
              <Cell
                key={point.horizon}
                fill={point.meanTicks < 0 ? 'var(--series-loss)' : 'var(--series-1)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}
