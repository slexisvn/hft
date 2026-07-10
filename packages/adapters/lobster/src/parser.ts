import {
  ConfigError,
  EV_CROSS_TRADE,
  EV_EXECUTE_HIDDEN,
  EV_TRADING_HALT,
  SIDE_ASK,
  SIDE_BID,
  type EventType,
  type Side,
} from '@hft/contracts';
import { EventBuffer, rawToTicks, type TickScale } from '@hft/events';

export const LOBSTER_EMPTY_PRICE = 9999999999;

export function parseSecondsToNanos(field: string): number {
  const dot = field.indexOf('.');
  if (dot < 0) {
    const whole = Number(field);
    if (!Number.isInteger(whole)) throw new ConfigError(`bad LOBSTER timestamp "${field}"`);
    return whole * 1_000_000_000;
  }
  const secText = field.slice(0, dot);
  let fracText = field.slice(dot + 1);
  if (fracText.length > 9) fracText = fracText.slice(0, 9);
  while (fracText.length < 9) fracText += '0';
  const sec = Number(secText);
  const frac = Number(fracText);
  if (!Number.isInteger(sec) || !Number.isInteger(frac)) {
    throw new ConfigError(`bad LOBSTER timestamp "${field}"`);
  }
  return sec * 1_000_000_000 + frac;
}

function splitLines(text: string): string[] {
  const raw = text.split('\n');
  const out: string[] = [];
  for (const line of raw) {
    const trimmed = line.charCodeAt(line.length - 1) === 13 ? line.slice(0, -1) : line;
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

export function parseMessages(text: string, scale: TickScale, initialCapacity: number): EventBuffer {
  const lines = splitLines(text);
  const buf = new EventBuffer(Math.max(initialCapacity, lines.length));
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) throw new ConfigError(`LOBSTER message line ${i + 1} has ${parts.length} fields, expected 6`);
    const ts = parseSecondsToNanos(parts[0]);
    const type = Number(parts[1]) as EventType;
    if (!Number.isInteger(type) || type < 1 || type > 7) {
      throw new ConfigError(`LOBSTER message line ${i + 1} has unknown type "${parts[1]}"`);
    }
    const orderId = Number(parts[2]);
    const size = Number(parts[3]);
    const rawPrice = Number(parts[4]);
    const direction = Number(parts[5]);

    let side: Side = SIDE_BID;
    if (direction === -1) side = SIDE_ASK;
    else if (direction !== 1) side = SIDE_BID;

    let ticks = 0;
    if (type === EV_EXECUTE_HIDDEN) {
      ticks = Math.round(rawPrice / scale.rawPerTick);
    } else if (type !== EV_TRADING_HALT && type !== EV_CROSS_TRADE) {
      ticks = rawToTicks(scale, rawPrice);
    }
    buf.push(ts, type, side, orderId, size, ticks);
  }
  return buf;
}

export interface OrderbookRows {
  readonly rows: number;
  readonly levels: number;
  readonly askPriceRaw: Float64Array;
  readonly askSize: Int32Array;
  readonly bidPriceRaw: Float64Array;
  readonly bidSize: Int32Array;
}

export function parseOrderbook(text: string, levels: number): OrderbookRows {
  const lines = splitLines(text);
  const n = lines.length;
  const askPriceRaw = new Float64Array(n * levels);
  const askSize = new Int32Array(n * levels);
  const bidPriceRaw = new Float64Array(n * levels);
  const bidSize = new Int32Array(n * levels);
  for (let r = 0; r < n; r++) {
    const parts = lines[r].split(',');
    if (parts.length < levels * 4) {
      throw new ConfigError(`LOBSTER orderbook line ${r + 1} has ${parts.length} fields, expected ${levels * 4}`);
    }
    for (let l = 0; l < levels; l++) {
      const base = l * 4;
      askPriceRaw[r * levels + l] = Number(parts[base]);
      askSize[r * levels + l] = Number(parts[base + 1]);
      bidPriceRaw[r * levels + l] = Number(parts[base + 2]);
      bidSize[r * levels + l] = Number(parts[base + 3]);
    }
  }
  return { rows: n, levels, askPriceRaw, askSize, bidPriceRaw, bidSize };
}

export function isEmptyLobsterPrice(rawPrice: number): boolean {
  return Math.abs(rawPrice) >= LOBSTER_EMPTY_PRICE;
}
