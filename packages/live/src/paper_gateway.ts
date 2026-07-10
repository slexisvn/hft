import {
  EV_EXECUTE_VISIBLE,
  LIQ_MAKER,
  LIQ_TAKER,
  SIDE_BID,
  type BookView,
  type EventType,
  type FillRecord,
  type Gateway,
  type Liquidity,
  type OrderRequest,
  type OrderSnapshot,
  type SchedulingClock,
  type Side,
  type Ticks,
} from '@hft/contracts';
import {
  ExecutionMatcher,
  L3Book,
  RestingOrders,
  isMarketable,
  makeLevelViews,
  takerWalk,
  type TakerSlice,
} from '@hft/book';

export interface PaperGatewayOptions {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
  readonly initialOrderCapacity: number;
  readonly snapshotDepth: number;
  readonly decisionLatencyNs: number;
  readonly orderEntryLatencyNs: number;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
}

export interface PaperGatewayHooks {
  onFill(fill: FillRecord): void;
  onOrderRejected(clientOrderId: string, reason: string): void;
}

export class PaperGateway implements Gateway {
  private readonly opts: PaperGatewayOptions;
  private readonly clock: SchedulingClock;
  private readonly hooks: PaperGatewayHooks;
  private readonly book: L3Book;
  private readonly resting = new RestingOrders();
  private readonly matcher = new ExecutionMatcher();
  private readonly pending = new Map<string, OrderRequest>();
  private readonly canceledBeforeArrival = new Set<string>();
  private readonly takerScratch;
  private readonly takerSlices: TakerSlice[] = [];
  private readonly seen = new Set<string>();

  private pos = 0;
  private cash = 0;
  private submissions = 0;

  constructor(opts: PaperGatewayOptions, clock: SchedulingClock, hooks: PaperGatewayHooks) {
    this.opts = opts;
    this.clock = clock;
    this.hooks = hooks;
    this.book = new L3Book({
      minPriceTicks: opts.minPriceTicks,
      maxPriceTicks: opts.maxPriceTicks,
      initialOrderCapacity: opts.initialOrderCapacity,
    });
    this.takerScratch = makeLevelViews(opts.snapshotDepth);
  }

  get submissionCount(): number {
    return this.submissions;
  }

  get cashTicks(): number {
    return this.cash;
  }

  submit(request: OrderRequest): void {
    if (this.seen.has(request.clientOrderId)) return;
    this.seen.add(request.clientOrderId);
    this.submissions++;
    this.pending.set(request.clientOrderId, request);
    const arriveAt = this.clock.now() + this.opts.decisionLatencyNs + this.opts.orderEntryLatencyNs;
    this.clock.schedule(arriveAt, () => this.onArrival(request));
  }

  cancel(clientOrderId: string): void {
    const arriveAt = this.clock.now() + this.opts.decisionLatencyNs + this.opts.orderEntryLatencyNs;
    this.clock.schedule(arriveAt, () => {
      if (this.pending.has(clientOrderId)) {
        this.canceledBeforeArrival.add(clientOrderId);
        return;
      }
      this.resting.remove(this.book, clientOrderId, 'canceled');
    });
  }

  openOrders(): readonly OrderSnapshot[] {
    const out: OrderSnapshot[] = [];
    for (const o of this.resting.all()) {
      out.push({
        clientOrderId: o.clientOrderId,
        side: o.side,
        priceTicks: o.priceTicks,
        size: o.size,
        remaining: o.remaining,
        state: o.state,
      });
    }
    for (const r of this.pending.values()) {
      out.push({
        clientOrderId: r.clientOrderId,
        side: r.side,
        priceTicks: r.priceTicks,
        size: r.size,
        remaining: r.size,
        state: 'pending',
      });
    }
    return out;
  }

  position(): number {
    return this.pos;
  }

  marketView(): BookView {
    return this.book;
  }

  applyMarketEvent(
    timestampNs: number,
    type: EventType,
    orderId: number,
    side: Side,
    priceTicks: Ticks,
    size: number,
  ): void {
    const isExecute = type === EV_EXECUTE_VISIBLE;
    if (isExecute) this.matcher.capture(this.book, this.resting, side, priceTicks);
    this.book.apply(timestampNs, type, orderId, side, priceTicks, size);
    if (isExecute) {
      this.matcher.resolve(this.book, this.resting, size, (order, qty, queuePosition) => {
        this.recordFill(order.clientOrderId, order.side, order.priceTicks, qty, queuePosition, LIQ_MAKER);
      });
    }
  }

  private onArrival(request: OrderRequest): void {
    this.pending.delete(request.clientOrderId);
    if (this.canceledBeforeArrival.delete(request.clientOrderId)) return;

    if (isMarketable(this.book, request.side, request.priceTicks)) {
      if (request.postOnly) {
        this.hooks.onOrderRejected(request.clientOrderId, 'post_only_would_cross');
        return;
      }
      const slices = takerWalk(
        this.book,
        request.side,
        request.priceTicks,
        request.size,
        this.takerScratch,
        this.takerSlices,
      );
      let filled = 0;
      for (let i = 0; i < slices; i++) {
        const s = this.takerSlices[i];
        this.recordFill(request.clientOrderId, request.side, s.priceTicks, s.qty, 0, LIQ_TAKER);
        filled += s.qty;
      }
      const rest = request.size - filled;
      if (rest > 0) this.resting.rest(this.book, request.clientOrderId, request.side, request.priceTicks, rest);
      return;
    }
    this.resting.rest(this.book, request.clientOrderId, request.side, request.priceTicks, request.size);
  }

  private recordFill(
    clientOrderId: string,
    side: Side,
    priceTicks: Ticks,
    qty: number,
    queuePosition: number,
    liquidity: Liquidity,
  ): void {
    const mid = this.book.midTicks();
    const feeBps = liquidity === LIQ_MAKER ? this.opts.makerFeeBps : this.opts.takerFeeBps;
    const notional = priceTicks * qty;
    this.cash += (side === SIDE_BID ? -notional : notional) - (notional * feeBps) / 10000;
    this.pos += side === SIDE_BID ? qty : -qty;
    this.hooks.onFill({
      timestampNs: this.clock.now(),
      clientOrderId,
      side,
      priceTicks,
      size: qty,
      queuePositionAtFill: queuePosition,
      midTicksAtFill: mid,
      liquidity,
    });
  }
}
