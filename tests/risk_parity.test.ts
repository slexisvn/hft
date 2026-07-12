import { describe, expect, it } from 'vitest';
import {
  type AvellanedaParams,
  type FillRecord,
  type Strategy,
  type StrategyContext,
} from '@hft/contracts';
import { SimClock, SimEngine } from '@hft/sim';
import { PaperGateway, buildGuardedGateway, type RiskGatewayParams } from '@hft/live';
import { AvellanedaStoikovStrategy } from '@hft/strategy';
import { buildEvents, eventAt } from './helpers';

const PARAMS: AvellanedaParams = {
  kind: 'avellaneda_stoikov',
  gamma: 0.1,
  sigmaTicksPerSqrtSecond: 0.5,
  kappa: 1.5,
  sessionStartNs: 0,
  sessionEndNs: 1_000_000_000,
  orderSize: 10,
  maxHalfSpreadTicks: 5,
  requoteThresholdTicks: 1,
  maxPosition: 200,
};

const BOOK = { minPriceTicks: 900, maxPriceTicks: 1100, initialOrderCapacity: 64, snapshotDepth: 5 };
const MD_NS = 0;
const DECISION_NS = 1;
const ENTRY_NS = 0;
const MAX_ORDERS_PER_SECOND = 5;

const RISK: RiskGatewayParams = {
  limits: { maxPosition: 10_000, maxLossTicks: 1e12, maxOrdersPerSecond: MAX_ORDERS_PER_SECOND, maxReconcileDrift: 0 },
  rateLimit: { capacityTokens: 1_000, refillTokensPerSecond: 1_000 },
};

interface RiskOutcome {
  readonly halt: string | null;
  readonly accepted: number;
}

function runSim(): RiskOutcome {
  let halt: string | null = null;
  const strategy = new AvellanedaStoikovStrategy(PARAMS);
  const engine = new SimEngine(
    {
      ...BOOK,
      marketDataLatencyNs: MD_NS,
      decisionLatencyNs: DECISION_NS,
      orderEntryLatencyNs: ENTRY_NS,
      makerFeeBps: 0,
      takerFeeBps: 0,
      inventorySampleIntervalNs: 1_000_000,
    },
    strategy,
    (inner, clock, onReject) =>
      buildGuardedGateway(inner, clock, RISK, {
        onOrderRejected: onReject,
        onHalted: (reason) => {
          if (halt === null) halt = reason;
        },
      }),
  );
  const result = engine.run(buildEvents());
  return { halt, accepted: result.submissionCount };
}

function runPaper(): RiskOutcome {
  let halt: string | null = null;
  const clock = new SimClock();
  const strategy: Strategy = new AvellanedaStoikovStrategy(PARAMS);
  const rejectQueue: { clientOrderId: string; reason: string }[] = [];

  const paper = new PaperGateway(
    { ...BOOK, decisionLatencyNs: DECISION_NS, orderEntryLatencyNs: ENTRY_NS, makerFeeBps: 0, takerFeeBps: 0 },
    clock,
    {
      onFill(fill: FillRecord): void {
        strategy.onFill(ctx, fill);
      },
      onOrderRejected(clientOrderId: string, reason: string): void {
        strategy.onOrderRejected(ctx, clientOrderId, reason);
      },
    },
  );

  const guarded = buildGuardedGateway(paper, clock, RISK, {
    onOrderRejected: (clientOrderId, reason) => rejectQueue.push({ clientOrderId, reason }),
    onHalted: (reason) => {
      if (halt === null) halt = reason;
    },
  });

  const ctx: StrategyContext = { clock, gateway: guarded };
  const flush = (): void => {
    while (rejectQueue.length > 0) {
      const r = rejectQueue.shift() as { clientOrderId: string; reason: string };
      strategy.onOrderRejected(ctx, r.clientOrderId, r.reason);
    }
  };

  const events = buildEvents();
  strategy.onStart(ctx);
  flush();

  let j = 0;
  for (;;) {
    const tLag = j < events.length ? events.timestampNs[j] + MD_NS : Number.POSITIVE_INFINITY;
    const tTimer = clock.peekTime();
    if (!Number.isFinite(tLag) && !Number.isFinite(tTimer)) break;
    if (tTimer <= tLag) {
      clock.runNext();
      continue;
    }
    clock.advanceTo(tLag);
    const e = eventAt(events, j);
    paper.applyMarketEvent(e.ts, e.type, e.orderId, e.side, e.priceTicks, e.size);
    j++;
    strategy.onMarketData(ctx, guarded.marketView());
    flush();
  }
  strategy.onStop(ctx);
  flush();
  return { halt, accepted: paper.submissionCount };
}

describe('RISK PARITY: same kill switch trips at the same point in sim and paper', () => {
  it('both halt on the order-rate limit after accepting the same number of orders', () => {
    const sim = runSim();
    const paper = runPaper();

    expect(sim.halt).toBe('max_order_rate');
    expect(paper.halt).toBe('max_order_rate');
    expect(sim.accepted).toBe(MAX_ORDERS_PER_SECOND);
    expect(paper.accepted).toBe(sim.accepted);
  });
});
