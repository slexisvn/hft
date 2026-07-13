import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { fetchStats, type LiveTelemetry, type StatsPayload } from '../lib/stats';
import { formatClockNs, formatInteger, formatSignedTicks, formatTicks } from '../lib/format';
import type { TableRow } from '../lib/table';
import { Panel } from './Panel';
import { CHART_HEIGHT, chartAxisProps, chartGridProps, chartTooltipProps } from './chartTheme';

const EQUITY_WINDOW = 120;

interface LiveStatDef {
  readonly key: keyof LiveTelemetry;
  readonly label: string;
  readonly format: (telemetry: LiveTelemetry) => string;
}

const LIVE_STAT_DEFS: readonly LiveStatDef[] = [
  { key: 'pnlTicks', label: 'PnL (ticks)', format: (t) => formatSignedTicks(t.pnlTicks) },
  { key: 'position', label: 'Inventory', format: (t) => formatInteger(t.position) },
  { key: 'openOrders', label: 'Open orders', format: (t) => formatInteger(t.openOrders.length) },
  { key: 'reconcileCount', label: 'Reconciles', format: (t) => formatInteger(t.reconcileCount) },
  { key: 'resyncCount', label: 'Resyncs', format: (t) => formatInteger(t.resyncCount) },
];

export interface LiveViewProps {
  readonly baseUrl: string;
  readonly pollMs: number;
}

function useEquityHistory(payload: StatsPayload | null): { sample: number; pnlTicks: number }[] {
  const [history, setHistory] = useState<{ sample: number; pnlTicks: number }[]>([]);
  const capturedAtNs = payload?.telemetry.capturedAtNs;
  useEffect(() => {
    if (payload === undefined || payload === null) return;
    setHistory((previous) => {
      const next = [...previous, { sample: previous.length, pnlTicks: payload.telemetry.pnlTicks }];
      return next.slice(Math.max(0, next.length - EQUITY_WINDOW));
    });
  }, [capturedAtNs, payload]);
  return history;
}

function KillSwitchBadge({ telemetry }: { telemetry: LiveTelemetry }): JSX.Element {
  const tone = telemetry.halted ? 'fail' : 'pass';
  const value = telemetry.halted ? `HALTED · ${telemetry.killSwitchReason ?? 'unknown'}` : 'ARMED';
  return (
    <span className={`badge tone-${tone}`}>
      <span className="badge-label">kill switch</span>
      <span className="badge-value">{value}</span>
    </span>
  );
}

export function LiveView({ baseUrl, pollMs }: LiveViewProps): JSX.Element {
  const fetcher = useMemo(() => (signal: AbortSignal) => fetchStats(baseUrl, signal), [baseUrl]);
  const { data, error, pending } = usePolling<StatsPayload>(fetcher, pollMs, true);
  const history = useEquityHistory(data);

  if (error !== null && data === null) {
    return (
      <Panel title="Live monitor">
        <p className="notice is-error">cannot reach {baseUrl}/stats — {error}</p>
      </Panel>
    );
  }
  if (data === null) {
    return (
      <Panel title="Live monitor">
        <p className="notice">{pending ? `connecting to ${baseUrl}…` : 'no data'}</p>
      </Panel>
    );
  }

  const telemetry = data.telemetry;
  return (
    <div className="live">
      <div className="badge-row">
        <span className="badge tone-neutral">
          <span className="badge-label">symbol</span>
          <span className="badge-value">{data.symbol}</span>
        </span>
        <span className={`badge tone-${telemetry.running ? 'pass' : 'neutral'}`}>
          <span className="badge-label">session</span>
          <span className="badge-value">{telemetry.running ? 'RUNNING' : 'IDLE'}</span>
        </span>
        <KillSwitchBadge telemetry={telemetry} />
        <span className="badge tone-neutral">
          <span className="badge-label">updated</span>
          <span className="badge-value">{formatClockNs(telemetry.capturedAtNs)}</span>
        </span>
        {error !== null && <span className="badge tone-fail"><span className="badge-value">stale: {error}</span></span>}
      </div>

      <div className="kpi-row">
        {LIVE_STAT_DEFS.map((def) => (
          <div key={def.key} className="kpi-card">
            <span className="kpi-label">{def.label}</span>
            <span className="kpi-value">{def.format(telemetry)}</span>
          </div>
        ))}
      </div>

      <Panel title="Live PnL" caption="mark-to-market, sampled each poll">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <LineChart data={history} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid {...chartGridProps} />
            <XAxis dataKey="sample" {...chartAxisProps} />
            <YAxis {...chartAxisProps} tickFormatter={formatTicks} width={64} />
            <Tooltip {...chartTooltipProps} formatter={(value: number) => formatTicks(value)} />
            <Line
              type="monotone"
              dataKey="pnlTicks"
              name="pnl (ticks)"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Panel>

      <div className="grid-two">
        <Panel title="Open orders" caption={`${telemetry.openOrders.length} live`}>
          <OrdersTable orders={telemetry.openOrders} />
        </Panel>
        <Panel title="Recent fills" caption={`${data.recentFills.length} rows`}>
          <FillsTable fills={data.recentFills} columns={data.fillsSchema.columns.map((c) => c.name)} />
        </Panel>
      </div>
    </div>
  );
}

function OrdersTable({ orders }: { orders: LiveTelemetry['openOrders'] }): JSX.Element {
  if (orders.length === 0) return <p className="notice">no open orders</p>;
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>client id</th>
          <th>state</th>
          <th>side</th>
          <th>price</th>
          <th>remaining</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.clientOrderId}>
            <td>{order.clientOrderId}</td>
            <td>{order.state}</td>
            <td>{order.side}</td>
            <td>{order.priceTicks}</td>
            <td>{order.remaining}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FillsTable({ fills, columns }: { fills: readonly TableRow[]; columns: readonly string[] }): JSX.Element {
  if (fills.length === 0) return <p className="notice">no fills recorded</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fills.map((fill, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column}>{String(fill[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
