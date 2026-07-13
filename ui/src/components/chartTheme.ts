export const CHART_HEIGHT = 260;

export const chartGridProps = {
  stroke: 'var(--grid)',
  strokeDasharray: '3 3',
} as const;

export const chartAxisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--text-muted)', fontSize: 12 },
} as const;

export const chartTooltipProps = {
  contentStyle: {
    background: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    borderRadius: 8,
    color: 'var(--text)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
  },
  itemStyle: { color: 'var(--text)' },
  labelStyle: { color: 'var(--text-muted)' },
  cursor: { stroke: 'var(--axis)' },
} as const;
