import { KillSwitchError, NANOS_PER_SECOND, type Clock, type Gateway } from '@hft/contracts';

export interface KillSwitchLimits {
  readonly maxPosition: number;
  readonly maxLossTicks: number;
  readonly maxOrdersPerSecond: number;
  readonly maxReconcileDrift: number;
}

export type KillSwitchReason =
  | 'max_position'
  | 'max_loss'
  | 'max_order_rate'
  | 'reconcile_drift'
  | 'manual';

export class KillSwitch {
  private readonly limits: KillSwitchLimits;
  private readonly clock: Clock;
  private readonly gateway: Gateway;
  private trippedReason: KillSwitchReason | null = null;
  private windowStartNs: number;
  private ordersInWindow = 0;

  constructor(limits: KillSwitchLimits, clock: Clock, gateway: Gateway) {
    this.limits = limits;
    this.clock = clock;
    this.gateway = gateway;
    this.windowStartNs = clock.now();
  }

  get tripped(): boolean {
    return this.trippedReason !== null;
  }

  get reason(): KillSwitchReason | null {
    return this.trippedReason;
  }

  private trip(reason: KillSwitchReason): never {
    if (this.trippedReason === null) {
      this.trippedReason = reason;
      for (const order of this.gateway.openOrders()) this.gateway.cancel(order.clientOrderId);
    }
    throw new KillSwitchError(reason);
  }

  onOrderSubmitted(): void {
    if (this.trippedReason !== null) this.trip(this.trippedReason);
    const now = this.clock.now();
    if (now - this.windowStartNs >= NANOS_PER_SECOND) {
      this.windowStartNs = now;
      this.ordersInWindow = 0;
    }
    this.ordersInWindow++;
    if (this.ordersInWindow > this.limits.maxOrdersPerSecond) this.trip('max_order_rate');
  }

  onPosition(position: number): void {
    if (Math.abs(position) > this.limits.maxPosition) this.trip('max_position');
  }

  onPnlTicks(pnlTicks: number): void {
    if (-pnlTicks > this.limits.maxLossTicks) this.trip('max_loss');
  }

  onReconcileDrift(drift: number): void {
    if (Math.abs(drift) > this.limits.maxReconcileDrift) this.trip('reconcile_drift');
  }

  halt(): void {
    this.trip('manual');
  }
}
