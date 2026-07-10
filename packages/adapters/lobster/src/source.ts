import { readFileSync } from 'node:fs';
import type { EventColumns, MarketDataSource } from '@hft/contracts';
import { createTickScale } from '@hft/events';
import { parseMessages } from './parser';

export interface LobsterSourceOptions {
  readonly messagePath: string;
  readonly tickSize: number;
  readonly priceScale: number;
  readonly initialCapacity: number;
}

export class LobsterMessageSource implements MarketDataSource {
  readonly name = 'lobster';
  private readonly opts: LobsterSourceOptions;

  constructor(opts: LobsterSourceOptions) {
    this.opts = opts;
  }

  load(): EventColumns {
    const scale = createTickScale(this.opts.tickSize, this.opts.priceScale);
    const text = readFileSync(this.opts.messagePath, 'utf8');
    return parseMessages(text, scale, this.opts.initialCapacity);
  }
}

export function priceTickRange(events: EventColumns): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const px = events.priceTicks;
  const et = events.eventType;
  for (let i = 0; i < events.length; i++) {
    if (et[i] === 6 || et[i] === 7) continue;
    const p = px[i];
    if (p < min) min = p;
    if (p > max) max = p;
  }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  return { min, max };
}

export function readTextFile(path: string): string {
  return readFileSync(path, 'utf8');
}
