import {
  KillSwitchError,
  type BookView,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
} from '@hft/contracts';
import { IdempotentSubmitter, type IdJournal } from './client_order_id';
import { KillSwitch } from './kill_switch';
import { OrderRegistry } from './order_state';
import { TokenBucket } from './rate_limit';

export type RejectReason = 'halted' | 'rate_limited' | 'duplicate_client_order_id';

export interface GuardedGatewayHooks {
  onOrderRejected(clientOrderId: string, reason: RejectReason): void;
  onHalted(reason: string): void;
}

export class GuardedGateway implements Gateway {
  private readonly inner: Gateway;
  private readonly bucket: TokenBucket;
  private readonly killSwitch: KillSwitch;
  private readonly registry: OrderRegistry;
  private readonly submitter: IdempotentSubmitter;
  private readonly hooks: GuardedGatewayHooks;
  private halted = false;

  constructor(
    inner: Gateway,
    bucket: TokenBucket,
    killSwitch: KillSwitch,
    registry: OrderRegistry,
    hooks: GuardedGatewayHooks,
    journal: IdJournal | null = null,
  ) {
    this.inner = inner;
    this.bucket = bucket;
    this.killSwitch = killSwitch;
    this.registry = registry;
    this.submitter = new IdempotentSubmitter(inner, journal);
    this.hooks = hooks;
  }

  restoreSentIds(clientOrderIds: Iterable<string>): void {
    this.submitter.restore(clientOrderIds);
  }

  restoreOpenOrders(orders: readonly OrderSnapshot[]): void {
    const ids: string[] = [];
    for (const order of orders) {
      this.registry.restore(order.clientOrderId, order.state);
      ids.push(order.clientOrderId);
    }
    this.submitter.restore(ids);
  }

  get isHalted(): boolean {
    return this.halted || this.killSwitch.tripped;
  }

  get orders(): OrderRegistry {
    return this.registry;
  }

  submit(request: OrderRequest): void {
    if (this.isHalted) {
      this.hooks.onOrderRejected(request.clientOrderId, 'halted');
      return;
    }
    if (this.submitter.wasSent(request.clientOrderId)) {
      this.hooks.onOrderRejected(request.clientOrderId, 'duplicate_client_order_id');
      return;
    }
    if (!this.bucket.tryAcquire()) {
      this.hooks.onOrderRejected(request.clientOrderId, 'rate_limited');
      return;
    }
    if (!this.guard(() => this.killSwitch.onOrderSubmitted())) {
      this.hooks.onOrderRejected(request.clientOrderId, 'halted');
      return;
    }
    this.registry.create(request.clientOrderId);
    this.submitter.submit(request);
  }

  cancel(clientOrderId: string): void {
    if (!this.registry.has(clientOrderId)) return;
    this.inner.cancel(clientOrderId);
  }

  amend(clientOrderId: string, newSize: number): void {
    if (this.isHalted) return;
    if (!this.registry.has(clientOrderId)) return;
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

  onAck(clientOrderId: string): void {
    this.registry.transition(clientOrderId, 'acked');
  }

  onFill(clientOrderId: string, remaining: number): void {
    this.registry.transition(clientOrderId, remaining > 0 ? 'partial' : 'filled');
    this.guard(() => this.killSwitch.onPosition(this.inner.position()));
  }

  onCanceled(clientOrderId: string): void {
    this.registry.transition(clientOrderId, 'canceled');
    this.submitter.forget(clientOrderId);
  }

  onExchangeReject(clientOrderId: string): void {
    this.registry.transition(clientOrderId, 'rejected');
    this.submitter.forget(clientOrderId);
  }

  onPnlTicks(pnlTicks: number): void {
    this.guard(() => this.killSwitch.onPnlTicks(pnlTicks));
  }

  onReconcileDrift(drift: number): void {
    this.guard(() => this.killSwitch.onReconcileDrift(drift));
  }

  halt(): void {
    this.guard(() => this.killSwitch.halt());
  }

  private guard(action: () => void): boolean {
    try {
      action();
      return true;
    } catch (err) {
      if (err instanceof KillSwitchError) {
        if (!this.halted) {
          this.halted = true;
          this.hooks.onHalted(err.reason);
        }
        return false;
      }
      throw err;
    }
  }
}
