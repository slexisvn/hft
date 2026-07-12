import { describe, expect, it } from 'vitest';
import {
  type BookView,
  type FillRecord,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
  type Strategy,
  type StrategyContext,
  type AvellanedaParams,
} from '@hft/contracts';
import { SimClock, SimEngine } from '@hft/sim';
import { PaperGateway } from '@hft/live';
import { AvellanedaStoikovStrategy } from '@hft/strategy';
import { buildEvents, eventAt, type Decision } from './helpers';

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

class RecordingGateway implements Gateway {
  constructor(
    private readonly inner: Gateway,
    private readonly sink: Decision[],
  ) {}
  submit(request: OrderRequest): void {
    this.sink.push({
      kind: 'submit',
      clientOrderId: request.clientOrderId,
      side: request.side,
      priceTicks: request.priceTicks,
      size: request.size,
    });
    this.inner.submit(request);
  }
  cancel(clientOrderId: string): void {
    this.sink.push({ kind: 'cancel', clientOrderId });
    this.inner.cancel(clientOrderId);
  }
  amend(clientOrderId: string, newSize: number): void {
    this.inner.amend(clientOrderId, newSize);
  }
  openOrders(): readonly OrderSnapshot[] {
    return this.inner.openOrders();
  }
  position(): number {
    return this.inner.position();
  }
  marketView(): BookView {
    return this.inner.marketView();
  }
}

class RecordingStrategy implements Strategy {
  readonly name: string;
  private readonly inner: Strategy;
  private readonly sink: Decision[];

  constructor(inner: Strategy, sink: Decision[]) {
    this.inner = inner;
    this.sink = sink;
    this.name = inner.name;
  }
  private wrap(ctx: StrategyContext): StrategyContext {
    return { clock: ctx.clock, gateway: new RecordingGateway(ctx.gateway, this.sink) };
  }
  onStart(ctx: StrategyContext): void {
    this.inner.onStart(this.wrap(ctx));
  }
  onMarketData(ctx: StrategyContext, view: BookView): void {
    this.inner.onMarketData(this.wrap(ctx), view);
  }
  onTrade(ctx: StrategyContext, sign: number, priceTicks: number, size: number): void {
    this.inner.onTrade(this.wrap(ctx), sign, priceTicks, size);
  }
  onFill(ctx: StrategyContext, fill: FillRecord): void {
    this.inner.onFill(this.wrap(ctx), fill);
  }
  onOrderRejected(ctx: StrategyContext, clientOrderId: string, reason: string): void {
    this.inner.onOrderRejected(this.wrap(ctx), clientOrderId, reason);
  }
  onStop(ctx: StrategyContext): void {
    this.inner.onStop(this.wrap(ctx));
  }
}

function runSim(): { decisions: Decision[]; fills: readonly FillRecord[] } {
  const decisions: Decision[] = [];
  const strategy = new RecordingStrategy(new AvellanedaStoikovStrategy(PARAMS), decisions);
  const engine = new SimEngine(
    {
      ...BOOK,
      marketDataLatencyNs: MD_NS,
      decisionLatencyNs: DECISION_NS,
      orderEntryLatencyNs: ENTRY_NS,
      makerFeeBps: 0,
      takerFeeBps: 0,
      inventorySampleIntervalNs: 1000000,
    },
    strategy,
  );
  const result = engine.run(buildEvents());
  return { decisions, fills: result.fills };
}

function runPaper(): { decisions: Decision[]; fills: readonly FillRecord[] } {
  const decisions: Decision[] = [];
  const fills: FillRecord[] = [];
  const clock = new SimClock();
  const inner = new AvellanedaStoikovStrategy(PARAMS);
  const strategy = new RecordingStrategy(inner, decisions);

  const gateway = new PaperGateway(
    { ...BOOK, decisionLatencyNs: DECISION_NS, orderEntryLatencyNs: ENTRY_NS, makerFeeBps: 0, takerFeeBps: 0 },
    clock,
    {
      onFill(fill: FillRecord): void {
        fills.push(fill);
        strategy.onFill({ clock, gateway }, fill);
      },
      onOrderRejected(clientOrderId: string, reason: string): void {
        strategy.onOrderRejected({ clock, gateway }, clientOrderId, reason);
      },
    },
  );

  const ctx: StrategyContext = { clock, gateway };
  const events = buildEvents();
  strategy.onStart(ctx);

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
    gateway.applyMarketEvent(e.ts, e.type, e.orderId, e.side, e.priceTicks, e.size);
    j++;
    strategy.onMarketData(ctx, gateway.marketView());
  }
  strategy.onStop(ctx);
  return { decisions, fills };
}

describe('PARITY: one strategy, two gateways', () => {
  it('produces an identical decision sequence through SimGateway and PaperGateway', () => {
    const sim = runSim();
    const paper = runPaper();
    expect(sim.decisions.length).toBeGreaterThan(0);
    expect(paper.decisions).toEqual(sim.decisions);
  });

  it('produces identical fills when the two gateways see identical books', () => {
    const sim = runSim();
    const paper = runPaper();
    expect(paper.fills).toEqual(sim.fills);
  });
});
