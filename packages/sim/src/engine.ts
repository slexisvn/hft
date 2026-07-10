import {
  EV_EXECUTE_HIDDEN,
  EV_EXECUTE_VISIBLE,
  LIQ_MAKER,
  LIQ_TAKER,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  type BookView,
  type EventColumns,
  type EventType,
  type FillRecord,
  type Gateway,
  type LevelView,
  type Liquidity,
  type OrderRequest,
  type OrderSnapshot,
  type Side,
  type Strategy,
  type StrategyContext,
  type Ticks,
} from '@hft/contracts';
import { ExecutionMatcher, L3Book, RestingOrders, makeLevelViews } from '@hft/book';
import { F64Vec, I32Vec } from '@hft/events';
import { SimClock } from './clock';
import { SimGateway, type GatewayBackend } from './gateway';
import { isMarketable, takerWalk, type TakerSlice } from './fill';

export interface SimOptions {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
  readonly initialOrderCapacity: number;
  readonly snapshotDepth: number;
  readonly marketDataLatencyNs: number;
  readonly decisionLatencyNs: number;
  readonly orderEntryLatencyNs: number;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly inventorySampleIntervalNs: number;
}

export interface QuoteStream {
  readonly timestampNs: Float64Array;
  readonly bidTicks: Int32Array;
  readonly bidSize: Int32Array;
  readonly askTicks: Int32Array;
  readonly askSize: Int32Array;
}

export interface TradeStream {
  readonly timestampNs: Float64Array;
  readonly priceTicks: Int32Array;
  readonly size: Int32Array;
  readonly sign: Int32Array;
  readonly hidden: Int32Array;
}

export interface SimResult {
  readonly fills: readonly FillRecord[];
  readonly quotes: QuoteStream;
  readonly trades: TradeStream;
  readonly submissionCount: number;
  readonly endPosition: number;
  readonly cashTicks: number;
  readonly pnlTicks: number;
  readonly inventoryTimestampNs: Float64Array;
  readonly inventory: Int32Array;
}

export class SimEngine implements GatewayBackend {
  private readonly opts: SimOptions;
  private readonly clock = new SimClock();
  private readonly liveBook: L3Book;
  private readonly laggedBook: L3Book;
  private readonly vbook = new RestingOrders();
  private readonly matcher = new ExecutionMatcher();
  private readonly gateway: SimGateway;
  private readonly strategy: Strategy;
  private readonly ctx: StrategyContext;

  private readonly pending = new Map<string, OrderRequest>();
  private readonly canceledBeforeArrival = new Set<string>();
  private readonly fills: FillRecord[] = [];

  private readonly qTs = new F64Vec(1024);
  private readonly qBid = new I32Vec(1024);
  private readonly qBidSize = new I32Vec(1024);
  private readonly qAsk = new I32Vec(1024);
  private readonly qAskSize = new I32Vec(1024);

  private readonly tTs = new F64Vec(1024);
  private readonly tPx = new I32Vec(1024);
  private readonly tSz = new I32Vec(1024);
  private readonly tSign = new I32Vec(1024);
  private readonly tHidden = new I32Vec(1024);

  private readonly invTs = new F64Vec(256);
  private readonly invQty = new I32Vec(256);

  private readonly takerScratch: LevelView[];
  private readonly takerSlices: TakerSlice[] = [];

  private position = 0;
  private cashTicks = 0;
  private nextInventorySampleNs = -1;
  private lastBid = NO_PRICE;
  private lastBidSize = -1;
  private lastAsk = NO_PRICE;
  private lastAskSize = -1;

  constructor(opts: SimOptions, strategy: Strategy) {
    this.opts = opts;
    this.strategy = strategy;
    const bookOpts = {
      minPriceTicks: opts.minPriceTicks,
      maxPriceTicks: opts.maxPriceTicks,
      initialOrderCapacity: opts.initialOrderCapacity,
    };
    this.liveBook = new L3Book(bookOpts);
    this.laggedBook = new L3Book(bookOpts);
    this.takerScratch = makeLevelViews(opts.snapshotDepth);
    this.gateway = new SimGateway(this, () => this.clock.now());
    this.ctx = { clock: this.clock, gateway: this.gateway };
  }

  get gatewayPort(): Gateway {
    return this.gateway;
  }

  onSubmit(request: OrderRequest, submittedAtNs: number): void {
    this.pending.set(request.clientOrderId, request);
    const arriveAt = submittedAtNs + this.opts.decisionLatencyNs + this.opts.orderEntryLatencyNs;
    this.clock.schedule(arriveAt, () => this.onOrderArrival(request));
  }

  onCancel(clientOrderId: string, submittedAtNs: number): void {
    const arriveAt = submittedAtNs + this.opts.decisionLatencyNs + this.opts.orderEntryLatencyNs;
    this.clock.schedule(arriveAt, () => this.onCancelArrival(clientOrderId));
  }

  snapshots(): readonly OrderSnapshot[] {
    const out: OrderSnapshot[] = [];
    for (const o of this.vbook.all()) {
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

  netPosition(): number {
    return this.position;
  }

  view(): BookView {
    return this.laggedBook;
  }

  private onOrderArrival(request: OrderRequest): void {
    this.pending.delete(request.clientOrderId);
    if (this.canceledBeforeArrival.delete(request.clientOrderId)) return;

    if (isMarketable(this.liveBook, request.side, request.priceTicks)) {
      if (request.postOnly) {
        this.strategy.onOrderRejected(this.ctx, request.clientOrderId, 'post_only_would_cross');
        return;
      }
      const slices = takerWalk(
        this.liveBook,
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
      if (rest > 0) this.vbook.rest(this.liveBook, request.clientOrderId, request.side, request.priceTicks, rest);
      return;
    }
    this.vbook.rest(this.liveBook, request.clientOrderId, request.side, request.priceTicks, request.size);
  }

  private onCancelArrival(clientOrderId: string): void {
    if (this.pending.has(clientOrderId)) {
      this.canceledBeforeArrival.add(clientOrderId);
      return;
    }
    this.vbook.remove(this.liveBook, clientOrderId, 'canceled');
  }

  private recordFill(
    clientOrderId: string,
    side: Side,
    priceTicks: Ticks,
    qty: number,
    queuePosition: number,
    liquidity: Liquidity,
  ): void {
    const mid = this.liveBook.midTicks();
    const feeBps = liquidity === LIQ_MAKER ? this.opts.makerFeeBps : this.opts.takerFeeBps;
    const notional = priceTicks * qty;
    this.cashTicks += (side === SIDE_BID ? -notional : notional) - (notional * feeBps) / 10000;
    this.position += side === SIDE_BID ? qty : -qty;

    const fill: FillRecord = {
      timestampNs: this.clock.now(),
      clientOrderId,
      side,
      priceTicks,
      size: qty,
      queuePositionAtFill: queuePosition,
      midTicksAtFill: mid,
      liquidity,
    };
    this.fills.push(fill);
    this.strategy.onFill(this.ctx, fill);
  }

  private applyLiveEvent(
    ts: number,
    type: EventType,
    orderId: number,
    side: Side,
    priceTicks: Ticks,
    size: number,
  ): void {
    this.sampleInventory(ts);

    const isExecute = type === EV_EXECUTE_VISIBLE;
    if (isExecute) this.matcher.capture(this.liveBook, this.vbook, side, priceTicks);

    this.liveBook.apply(ts, type, orderId, side, priceTicks, size);

    if (isExecute) {
      this.matcher.resolve(this.liveBook, this.vbook, size, (order, qty, queuePosition) => {
        this.recordFill(order.clientOrderId, order.side, order.priceTicks, qty, queuePosition, LIQ_MAKER);
      });
    }

    if (type === EV_EXECUTE_VISIBLE || type === EV_EXECUTE_HIDDEN) {
      this.tTs.push(ts);
      this.tPx.push(priceTicks);
      this.tSz.push(size);
      this.tSign.push(side === SIDE_BID ? -1 : 1);
      this.tHidden.push(type === EV_EXECUTE_HIDDEN ? 1 : 0);
    }

    this.recordQuote(ts);
  }

  private sampleInventory(ts: number): void {
    const step = this.opts.inventorySampleIntervalNs;
    if (this.nextInventorySampleNs < 0) {
      this.nextInventorySampleNs = ts;
    }
    while (ts >= this.nextInventorySampleNs) {
      this.invTs.push(this.nextInventorySampleNs);
      this.invQty.push(this.position);
      this.nextInventorySampleNs += step;
    }
  }

  private recordQuote(ts: number): void {
    const bid = this.liveBook.bestBidTicks();
    const ask = this.liveBook.bestAskTicks();
    const bidSize = bid === NO_PRICE ? 0 : this.liveBook.sizeAt(SIDE_BID, bid);
    const askSize = ask === NO_PRICE ? 0 : this.liveBook.sizeAt(SIDE_ASK, ask);
    if (bid === this.lastBid && ask === this.lastAsk && bidSize === this.lastBidSize && askSize === this.lastAskSize) {
      return;
    }
    this.lastBid = bid;
    this.lastAsk = ask;
    this.lastBidSize = bidSize;
    this.lastAskSize = askSize;
    this.qTs.push(ts);
    this.qBid.push(bid);
    this.qBidSize.push(bidSize);
    this.qAsk.push(ask);
    this.qAskSize.push(askSize);
  }

  run(events: EventColumns): SimResult {
    const n = events.length;
    const ts = events.timestampNs;
    const et = events.eventType;
    const sd = events.side;
    const oid = events.orderId;
    const sz = events.sizeQty;
    const px = events.priceTicks;
    const md = this.opts.marketDataLatencyNs;

    this.strategy.onStart(this.ctx);

    let i = 0;
    let j = 0;
    for (;;) {
      const tLive = i < n ? ts[i] : Number.POSITIVE_INFINITY;
      const tLag = j < n ? ts[j] + md : Number.POSITIVE_INFINITY;
      const tTimer = this.clock.peekTime();
      const tMin = Math.min(tLive, Math.min(tTimer, tLag));
      if (!Number.isFinite(tMin)) break;

      if (tLive === tMin) {
        this.clock.advanceTo(tLive);
        this.applyLiveEvent(ts[i], et[i] as EventType, oid[i], sd[i] as Side, px[i], sz[i]);
        i++;
        continue;
      }
      if (tTimer === tMin) {
        this.clock.runNext();
        continue;
      }
      this.clock.advanceTo(tLag);
      this.laggedBook.apply(ts[j], et[j] as EventType, oid[j], sd[j] as Side, px[j], sz[j]);
      j++;
      this.strategy.onMarketData(this.ctx, this.laggedBook);
    }

    this.strategy.onStop(this.ctx);
    this.sampleInventory(this.clock.now());

    const mid = this.liveBook.midTicks();
    const marked = Number.isFinite(mid) ? this.cashTicks + this.position * mid : this.cashTicks;

    return {
      fills: this.fills,
      quotes: {
        timestampNs: this.qTs.view(),
        bidTicks: this.qBid.view(),
        bidSize: this.qBidSize.view(),
        askTicks: this.qAsk.view(),
        askSize: this.qAskSize.view(),
      },
      trades: {
        timestampNs: this.tTs.view(),
        priceTicks: this.tPx.view(),
        size: this.tSz.view(),
        sign: this.tSign.view(),
        hidden: this.tHidden.view(),
      },
      submissionCount: this.gateway.submissionCount,
      endPosition: this.position,
      cashTicks: this.cashTicks,
      pnlTicks: marked,
      inventoryTimestampNs: this.invTs.view(),
      inventory: this.invQty.view(),
    };
  }
}
