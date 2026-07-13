import type { OrderSnapshot } from '@hft/contracts';

export interface OpenOrderView {
  readonly clientOrderId: string;
  readonly state: OrderSnapshot['state'];
  readonly side: OrderSnapshot['side'];
  readonly priceTicks: OrderSnapshot['priceTicks'];
  readonly remaining: OrderSnapshot['remaining'];
}

export interface LiveTelemetry {
  readonly capturedAtNs: number;
  readonly running: boolean;
  readonly halted: boolean;
  readonly killSwitchReason: string | null;
  readonly position: number;
  readonly pnlTicks: number;
  readonly openOrders: readonly OpenOrderView[];
  readonly resyncCount: number;
  readonly reconcileCount: number;
}

export interface TelemetryClock {
  now(): number;
}

export interface TelemetrySession {
  readonly isRunning: boolean;
  readonly resyncCount: number;
  readonly reconcileCount: number;
}

export interface TelemetryGateway {
  readonly isHalted: boolean;
  position(): number;
  openOrders(): readonly OrderSnapshot[];
}

export interface TelemetryKillSwitch {
  readonly reason: string | null;
}

export interface TelemetrySources {
  readonly clock: TelemetryClock;
  readonly session: TelemetrySession;
  readonly gateway: TelemetryGateway;
  readonly killSwitch: TelemetryKillSwitch;
  markToMarketPnlTicks(): number;
}

function toOpenOrderView(order: OrderSnapshot): OpenOrderView {
  return {
    clientOrderId: order.clientOrderId,
    state: order.state,
    side: order.side,
    priceTicks: order.priceTicks,
    remaining: order.remaining,
  };
}

export function captureTelemetry(sources: TelemetrySources): LiveTelemetry {
  const pnlTicks = sources.markToMarketPnlTicks();
  return {
    capturedAtNs: sources.clock.now(),
    running: sources.session.isRunning,
    halted: sources.gateway.isHalted,
    killSwitchReason: sources.killSwitch.reason,
    position: sources.gateway.position(),
    pnlTicks: Number.isFinite(pnlTicks) ? pnlTicks : 0,
    openOrders: sources.gateway.openOrders().map(toOpenOrderView),
    resyncCount: sources.session.resyncCount,
    reconcileCount: sources.session.reconcileCount,
  };
}
