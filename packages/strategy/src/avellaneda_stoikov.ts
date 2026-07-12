import {
  NANOS_PER_SECOND,
  SIDE_ASK,
  SIDE_BID,
  type AvellanedaParams,
  type BookView,
  type FillRecord,
  type Strategy,
  type StrategyContext,
} from '@hft/contracts';
import { TwoSidedQuoter, defaultIdFactory, type ClientOrderIdFactory } from './quoter';

export function reservationPriceTicks(
  midTicks: number,
  inventory: number,
  gamma: number,
  sigmaTicksPerSqrtSecond: number,
  timeRemainingSeconds: number,
): number {
  return midTicks - inventory * gamma * sigmaTicksPerSqrtSecond * sigmaTicksPerSqrtSecond * timeRemainingSeconds;
}

export function optimalSpreadTicks(
  gamma: number,
  sigmaTicksPerSqrtSecond: number,
  timeRemainingSeconds: number,
  kappa: number,
): number {
  return (
    gamma * sigmaTicksPerSqrtSecond * sigmaTicksPerSqrtSecond * timeRemainingSeconds +
    (2 / gamma) * Math.log(1 + gamma / kappa)
  );
}

export class AvellanedaStoikovStrategy implements Strategy {
  readonly name = 'avellaneda_stoikov';
  private readonly params: AvellanedaParams;
  private readonly quoter: TwoSidedQuoter;

  constructor(params: AvellanedaParams, idFactory: ClientOrderIdFactory = defaultIdFactory('as')) {
    this.params = params;
    this.quoter = new TwoSidedQuoter(idFactory, params.requoteThresholdTicks);
  }

  onStart(): void {}

  onMarketData(ctx: StrategyContext, view: BookView): void {
    const mid = view.midTicks();
    if (!Number.isFinite(mid)) return;

    const p = this.params;
    const remainingNs = p.sessionEndNs - ctx.clock.now();
    if (remainingNs <= 0) {
      this.quoter.withdrawAll(ctx.gateway);
      return;
    }
    const horizonNs = p.sessionEndNs - p.sessionStartNs;
    const timeRemaining = Math.min(remainingNs, horizonNs) / NANOS_PER_SECOND;

    const inventory = ctx.gateway.position();
    const reservation = reservationPriceTicks(mid, inventory, p.gamma, p.sigmaTicksPerSqrtSecond, timeRemaining);
    const spread = optimalSpreadTicks(p.gamma, p.sigmaTicksPerSqrtSecond, timeRemaining, p.kappa);
    const half = Math.min(spread / 2, p.maxHalfSpreadTicks);

    let bid = Math.floor(reservation - half);
    let ask = Math.ceil(reservation + half);
    if (ask <= bid) ask = bid + 1;

    const bestAsk = view.bestAskTicks();
    const bestBid = view.bestBidTicks();
    if (bestAsk >= 0 && bid >= bestAsk) bid = bestAsk - 1;
    if (bestBid >= 0 && ask <= bestBid) ask = bestBid + 1;

    this.quoter.desireWithinPosition(ctx.gateway, SIDE_BID, bid, p.orderSize, inventory, p.maxPosition);
    this.quoter.desireWithinPosition(ctx.gateway, SIDE_ASK, ask, p.orderSize, inventory, p.maxPosition);
  }

  onTrade(): void {}

  onFill(_ctx: StrategyContext, fill: FillRecord): void {
    this.quoter.onFill(fill.clientOrderId, fill.size);
  }

  onOrderRejected(_ctx: StrategyContext, clientOrderId: string): void {
    this.quoter.onRejected(clientOrderId);
  }

  onStop(ctx: StrategyContext): void {
    this.quoter.withdrawAll(ctx.gateway);
  }
}
