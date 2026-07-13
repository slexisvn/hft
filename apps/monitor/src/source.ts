import { readFileSync } from 'node:fs';
import {
  FILLS_SCHEMA,
  LIVE_FILLS_SCHEMA,
  cashDeltaTicks,
  columnIndex,
  markToMarketTicks,
  parseCsv,
  positionDeltaQty,
  type ColumnType,
  type LinearModelArtifact,
  type MetricsJson,
  type Side,
  type StrategyConfig,
  type TableSchema,
} from '@hft/contracts';
import {
  GuardedGateway,
  KillSwitch,
  LiveSession,
  OrderRegistry,
  PaperGateway,
  RealSchedulingClock,
  TokenBucket,
  captureTelemetry,
  type LiveTelemetry,
} from '@hft/live';

export type FillRow = Readonly<Record<string, number | string>>;

export interface StatsSnapshot {
  readonly telemetry: LiveTelemetry;
  readonly recentFills: readonly FillRow[];
  readonly fillsSchema: TableSchema;
  readonly strategy: string;
  readonly symbol: string;
}

export interface ReportSnapshot {
  readonly metrics: MetricsJson | null;
  readonly model: LinearModelArtifact | null;
  readonly fills: readonly FillRow[];
  readonly fillsSchema: TableSchema;
}

export interface StatsSource {
  read(): StatsSnapshot;
  readReport(): ReportSnapshot;
}

function coerceCell(value: string, type: ColumnType): number | string {
  return type === 'str' ? value : Number(value);
}

function readTable(path: string, schema: TableSchema, limit: number): FillRow[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) return [];
  const indices = schema.columns.map((column) => ({
    name: column.name,
    type: column.type,
    at: columnIndex(parsed.header, column.name),
  }));
  const start = Math.max(0, parsed.rows.length - limit);
  const rows: FillRow[] = [];
  for (let i = start; i < parsed.rows.length; i++) {
    const source = parsed.rows[i];
    const record: Record<string, number | string> = {};
    for (const column of indices) record[column.name] = coerceCell(source[column.at], column.type);
    rows.push(record);
  }
  return rows;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function createStatsSource(config: StrategyConfig, recentFillsLimit: number): StatsSource {
  const clock = new RealSchedulingClock();
  const transport = new PaperGateway(
    {
      minPriceTicks: config.instrument.minPriceTicks,
      maxPriceTicks: config.instrument.maxPriceTicks,
      initialOrderCapacity: config.sim.initialOrderCapacity,
      snapshotDepth: config.book.snapshotDepth,
      decisionLatencyNs: config.latency.decisionNs,
      orderEntryLatencyNs: config.latency.orderEntryNs,
      makerFeeBps: config.sim.makerFeeBps,
      takerFeeBps: config.sim.takerFeeBps,
    },
    clock,
    { onFill: () => {}, onOrderRejected: () => {} },
  );
  const killSwitch = new KillSwitch(
    {
      maxPosition: config.risk.maxPosition,
      maxLossTicks: config.risk.maxLossTicks,
      maxOrdersPerSecond: config.risk.maxOrdersPerSecond,
      maxReconcileDrift: config.risk.reconcileToleranceQty,
    },
    clock,
    transport,
  );
  const gateway = new GuardedGateway(
    transport,
    new TokenBucket(config.live.rateLimit.capacityTokens, config.live.rateLimit.refillTokensPerSecond, clock),
    killSwitch,
    new OrderRegistry(),
    { onOrderRejected: () => {}, onHalted: () => {} },
  );
  const session = new LiveSession(
    clock,
    gateway,
    {
      reconcileIntervalNs: config.live.reconcileIntervalNs,
      reconcileToleranceQty: config.risk.reconcileToleranceQty,
      resyncOnSequenceGap: config.live.resyncOnSequenceGap,
    },
    {
      fetchExchangeAccount: () => ({ position: gateway.position(), openOrders: gateway.openOrders() }),
      resyncOrderBookSnapshot: () => {},
      onReconcile: () => {},
      markToMarketPnlTicks: () => markToMarketTicks(0, gateway.position(), gateway.marketView().midTicks()),
    },
  );

  return {
    read(): StatsSnapshot {
      const telemetry = captureTelemetry({
        clock,
        session,
        gateway,
        killSwitch,
        markToMarketPnlTicks: () => markToMarketTicks(0, gateway.position(), gateway.marketView().midTicks()),
      });
      return {
        telemetry,
        recentFills: readTable(config.output.liveFillsPath, LIVE_FILLS_SCHEMA, recentFillsLimit),
        fillsSchema: LIVE_FILLS_SCHEMA,
        strategy: config.strategy.kind,
        symbol: config.instrument.symbol,
      };
    },
    readReport: () => reportFrom(config),
  };
}

const FILL_CLIENT_ID = 'client_order_id';
const FILL_SIDE = 'side';
const FILL_PRICE_TICKS = 'price_ticks';
const FILL_SIZE = 'size';
const FILL_MID_TICKS = 'mid_ticks_at_fill';
const GROSS_FEE_BPS = 0;
const REVEAL_INTERVAL_MS = 700;

function reportFrom(config: StrategyConfig): ReportSnapshot {
  return {
    metrics: readJson<MetricsJson>(config.output.metricsPath),
    model: readJson<LinearModelArtifact>(config.train.modelPath),
    fills: readTable(config.output.fillsPath, FILLS_SCHEMA, Number.MAX_SAFE_INTEGER),
    fillsSchema: FILLS_SCHEMA,
  };
}

export function createReplaySource(config: StrategyConfig, recentFillsLimit: number): StatsSource {
  const fills = readTable(config.output.fillsPath, FILLS_SCHEMA, Number.MAX_SAFE_INTEGER);
  const startMs = Date.now();
  const revealed: FillRow[] = [];
  let cursor = 0;
  let cashTicks = 0;
  let position = 0;
  let lastMidTicks = Number.NaN;

  const advanceTo = (targetCount: number): void => {
    while (cursor < targetCount) {
      const index = cursor % fills.length;
      if (index === 0) {
        cashTicks = 0;
        position = 0;
      }
      const row = fills[index];
      const side = Number(row[FILL_SIDE]) as Side;
      cashTicks += cashDeltaTicks(side, Number(row[FILL_PRICE_TICKS]), Number(row[FILL_SIZE]), GROSS_FEE_BPS);
      position += positionDeltaQty(side, Number(row[FILL_SIZE]));
      lastMidTicks = Number(row[FILL_MID_TICKS]);
      revealed.push(row);
      if (revealed.length > recentFillsLimit) revealed.shift();
      cursor++;
    }
  };

  const pendingOrder = (): LiveTelemetry['openOrders'] => {
    if (fills.length === 0) return [];
    const next = fills[cursor % fills.length];
    return [
      {
        clientOrderId: String(next[FILL_CLIENT_ID]),
        state: 'acked',
        side: Number(next[FILL_SIDE]) as Side,
        priceTicks: Number(next[FILL_PRICE_TICKS]),
        remaining: Number(next[FILL_SIZE]),
      },
    ];
  };

  return {
    read(): StatsSnapshot {
      if (fills.length > 0) advanceTo(Math.floor((Date.now() - startMs) / REVEAL_INTERVAL_MS));
      const telemetry: LiveTelemetry = {
        capturedAtNs: Date.now() * 1_000_000,
        running: fills.length > 0,
        halted: false,
        killSwitchReason: null,
        position,
        pnlTicks: markToMarketTicks(cashTicks, position, lastMidTicks),
        openOrders: pendingOrder(),
        resyncCount: 0,
        reconcileCount: cursor,
      };
      return {
        telemetry,
        recentFills: [...revealed].reverse(),
        fillsSchema: FILLS_SCHEMA,
        strategy: config.strategy.kind,
        symbol: config.instrument.symbol,
      };
    },
    readReport: () => reportFrom(config),
  };
}
