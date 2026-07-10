import { ConfigError } from '@hft/contracts';

export interface TickScale {
  readonly tickSize: number;
  readonly priceScale: number;
  readonly rawPerTick: number;
}

export function createTickScale(tickSize: number, priceScale: number): TickScale {
  const rawPerTick = Math.round(tickSize * priceScale);
  if (rawPerTick <= 0) {
    throw new ConfigError(`tickSize ${tickSize} x priceScale ${priceScale} must yield a positive integer`);
  }
  if (Math.abs(tickSize * priceScale - rawPerTick) > 1e-9) {
    throw new ConfigError(`tickSize ${tickSize} is not an integer multiple of 1/${priceScale}`);
  }
  return { tickSize, priceScale, rawPerTick };
}

export function rawToTicks(scale: TickScale, rawPrice: number): number {
  const ticks = rawPrice / scale.rawPerTick;
  if (!Number.isInteger(ticks)) {
    throw new ConfigError(`raw price ${rawPrice} is not a multiple of ${scale.rawPerTick} raw units per tick`);
  }
  return ticks;
}

export function ticksToRaw(scale: TickScale, ticks: number): number {
  return ticks * scale.rawPerTick;
}

export function ticksToPrice(scale: TickScale, ticks: number): number {
  return (ticks * scale.rawPerTick) / scale.priceScale;
}

export function priceToTicks(scale: TickScale, price: number): number {
  return rawToTicks(scale, Math.round(price * scale.priceScale));
}
