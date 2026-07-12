import {
  ConfigError,
  LIQ_MAKER,
  LIQ_TAKER,
  OrderStateError,
  SIDE_ASK,
  SIDE_BID,
  oppositeSide,
  type BookView,
  type Clock,
  type FillRecord,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
  type OrderState,
  type Side,
} from '@hft/contracts';
import { L2Book } from '@hft/book';
import { rawToTicks, type TickScale } from '@hft/events';
import { DepthSynchronizer, type DepthOutcome } from './depth_sync';
import type { BinanceDepthUpdate, DepthSnapshot, ExecutionReport, OrderTransport } from './transport';

export interface NormalizedLevelUpdate {
  readonly side: Side;
  readonly priceTicks: number;
  readonly size: number;
}

export interface BinanceGatewayOptions {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
}

export interface BinanceGatewayHooks {
  onFill(fill: FillRecord): void;
  onOrderRejected(clientOrderId: string, reason: string): void;
  onResyncRequired(): void;
}

function priceToTicks(scale: TickScale, price: string): number {
  return rawToTicks(scale, Math.round(Number(price) * scale.priceScale));
}

export function normalizeDepthUpdate(
  update: BinanceDepthUpdate,
  scale: TickScale,
  out: NormalizedLevelUpdate[],
): number {
  let n = 0;
  for (const [price, qty] of update.bids) {
    out[n++] = { side: SIDE_BID, priceTicks: priceToTicks(scale, price), size: Math.round(Number(qty)) };
  }
  for (const [price, qty] of update.asks) {
    out[n++] = { side: SIDE_ASK, priceTicks: priceToTicks(scale, price), size: Math.round(Number(qty)) };
  }
  return n;
}

interface WorkingOrder {
  readonly request: OrderRequest;
  remaining: number;
  state: OrderState;
  cursor: number;
}

export class BinanceGateway implements Gateway {
  readonly name = 'binance';
  private readonly opts: BinanceGatewayOptions;
  private readonly scale: TickScale;
  private readonly clock: Clock;
  private readonly transport: OrderTransport | null;
  private readonly hooks: BinanceGatewayHooks;
  private readonly book: L2Book;
  private readonly sync = new DepthSynchronizer();
  private readonly working = new Map<string, WorkingOrder>();
  private readonly scratch: NormalizedLevelUpdate[] = [];
  private pos = 0;

  constructor(
    opts: BinanceGatewayOptions,
    scale: TickScale,
    clock: Clock,
    transport: OrderTransport | null,
    hooks: BinanceGatewayHooks,
  ) {
    this.opts = opts;
    this.scale = scale;
    this.clock = clock;
    this.transport = transport;
    this.hooks = hooks;
    this.book = new L2Book({ minPriceTicks: opts.minPriceTicks, maxPriceTicks: opts.maxPriceTicks });
  }

  get isSynced(): boolean {
    return this.sync.syncState === 'synced';
  }

  submit(request: OrderRequest): void {
    if (this.transport === null) {
      throw new ConfigError('BinanceGateway has no order transport: construct it with an OrderTransport');
    }
    if (this.working.has(request.clientOrderId)) {
      throw new OrderStateError(`client order id "${request.clientOrderId}" is already working`);
    }
    this.working.set(request.clientOrderId, {
      request,
      remaining: request.size,
      state: 'pending',
      cursor: -1,
    });
    this.transport.sendOrder(request);
  }

  cancel(clientOrderId: string): void {
    if (this.transport === null) {
      throw new ConfigError('BinanceGateway has no order transport: construct it with an OrderTransport');
    }
    if (!this.working.has(clientOrderId)) return;
    this.transport.cancelOrder(clientOrderId);
  }

  amend(clientOrderId: string, newSize: number): void {
    const order = this.working.get(clientOrderId);
    if (order === undefined) return;
    const filled = order.request.size - order.remaining;
    if (newSize >= order.request.size || newSize <= filled) return;
    order.remaining = newSize - filled;
  }

  openOrders(): readonly OrderSnapshot[] {
    const out: OrderSnapshot[] = [];
    for (const o of this.working.values()) {
      out.push({
        clientOrderId: o.request.clientOrderId,
        side: o.request.side,
        priceTicks: o.request.priceTicks,
        size: o.request.size,
        remaining: o.remaining,
        state: o.state,
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

  onDepthSnapshot(snapshot: DepthSnapshot): void {
    this.book.reset();
    for (const o of this.working.values()) o.cursor = -1;

    const ts = this.clock.now();
    for (const [price, qty] of snapshot.bids) {
      this.book.setLevel(ts, SIDE_BID, priceToTicks(this.scale, price), Math.round(Number(qty)));
    }
    for (const [price, qty] of snapshot.asks) {
      this.book.setLevel(ts, SIDE_ASK, priceToTicks(this.scale, price), Math.round(Number(qty)));
    }

    const pending = this.sync.applySnapshot(snapshot.lastUpdateId);
    if (this.sync.syncState !== 'synced') {
      this.hooks.onResyncRequired();
      return;
    }
    for (const update of pending) this.applyLevels(update);
    for (const o of this.working.values()) {
      if (o.state === 'acked' || o.state === 'partial') this.attachCursor(o);
    }
  }

  onDepthUpdate(update: BinanceDepthUpdate): DepthOutcome {
    const outcome = this.sync.accept(update);
    if (outcome === 'applied') this.applyLevels(update);
    if (outcome === 'resync_required') {
      this.sync.reset();
      this.hooks.onResyncRequired();
    }
    return outcome;
  }

  onTrade(timestampNs: number, priceTicks: number, size: number, buyerIsMaker: boolean): void {
    const restingSide: Side = buyerIsMaker ? SIDE_BID : SIDE_ASK;
    this.book.applyTrade(timestampNs, restingSide, priceTicks, size);
  }

  onExecutionReport(report: ExecutionReport): void {
    const order = this.working.get(report.clientOrderId);
    if (order === undefined) return;

    switch (report.status) {
      case 'NEW':
        order.state = 'acked';
        this.attachCursor(order);
        return;
      case 'PARTIALLY_FILLED':
      case 'FILLED': {
        if (report.lastFilledQty <= 0) return;
        const queuePosition = order.cursor >= 0 ? this.book.cursorAhead(order.cursor) : 0;
        order.remaining = report.remainingQty;
        order.state = report.status === 'FILLED' ? 'filled' : 'partial';
        this.pos += order.request.side === SIDE_BID ? report.lastFilledQty : -report.lastFilledQty;
        this.hooks.onFill({
          timestampNs: report.transactTimeNs,
          clientOrderId: report.clientOrderId,
          side: order.request.side,
          priceTicks: report.lastFilledPriceTicks,
          size: report.lastFilledQty,
          queuePositionAtFill: queuePosition,
          midTicksAtFill: this.book.midTicks(),
          liquidity: report.isMaker ? LIQ_MAKER : LIQ_TAKER,
          depthAtFill: this.book.sizeAt(order.request.side, report.lastFilledPriceTicks),
          spreadTicksAtFill: this.book.spreadTicks(),
        });
        if (report.status === 'FILLED') this.retire(report.clientOrderId);
        return;
      }
      case 'CANCELED':
      case 'EXPIRED':
        this.retire(report.clientOrderId);
        return;
      case 'REJECTED':
        this.retire(report.clientOrderId);
        this.hooks.onOrderRejected(report.clientOrderId, 'exchange_rejected');
        return;
      default:
        throw new OrderStateError(`unknown execution status for "${report.clientOrderId}"`);
    }
  }

  private attachCursor(order: WorkingOrder): void {
    if (order.cursor >= 0 || !this.isSynced) return;
    order.cursor = this.book.registerCursor(order.request.side, order.request.priceTicks);
  }

  private retire(clientOrderId: string): void {
    const order = this.working.get(clientOrderId);
    if (order === undefined) return;
    if (order.cursor >= 0) this.book.releaseCursor(order.cursor);
    this.working.delete(clientOrderId);
  }

  private applyLevels(update: BinanceDepthUpdate): void {
    const n = normalizeDepthUpdate(update, this.scale, this.scratch);
    const ts = this.clock.now();
    for (let i = 0; i < n; i++) {
      const level = this.scratch[i];
      if (level.priceTicks < this.opts.minPriceTicks || level.priceTicks > this.opts.maxPriceTicks) continue;
      this.book.setLevel(ts, level.side, level.priceTicks, level.size);
    }
  }
}

export function restingSideOfTrade(aggressorSide: Side): Side {
  return oppositeSide(aggressorSide);
}
