import { describe, expect, it } from 'vitest';
import { ConfigError, EV_NEW_LIMIT_ORDER, SIDE_ASK, SIDE_BID } from '@hft/contracts';
import { EventBuffer, F64Vec, I32Vec, createTickScale, priceToTicks, rawToTicks, ticksToPrice, ticksToRaw } from '@hft/events';

describe('tick scale', () => {
  const scale = createTickScale(0.01, 10000);

  it('converts raw LOBSTER prices to integer ticks and back', () => {
    expect(rawToTicks(scale, 1000000)).toBe(10000);
    expect(ticksToRaw(scale, 10000)).toBe(1000000);
    expect(ticksToPrice(scale, 10000)).toBe(100);
    expect(priceToTicks(scale, 100.01)).toBe(10001);
  });

  it('refuses a raw price that is not a whole number of ticks', () => {
    expect(() => rawToTicks(scale, 1000050)).toThrowError(ConfigError);
  });

  it('refuses a tick size that is not a multiple of the price scale', () => {
    expect(() => createTickScale(0.000001, 10000)).toThrowError(ConfigError);
  });

  it('never compares floats at a price level', () => {
    const a = priceToTicks(scale, 0.1 + 0.2);
    const b = priceToTicks(scale, 0.3);
    expect(a).toBe(b);
  });
});

describe('EventBuffer', () => {
  it('stores columns as typed arrays and grows without losing data', () => {
    const buf = new EventBuffer(1);
    for (let i = 0; i < 100; i++) {
      buf.push(i * 1000, EV_NEW_LIMIT_ORDER, i % 2 === 0 ? SIDE_BID : SIDE_ASK, i + 1, 10 + i, 5000 + i);
    }
    expect(buf.length).toBe(100);
    expect(buf.timestampNs).toBeInstanceOf(Float64Array);
    expect(buf.orderId).toBeInstanceOf(Int32Array);
    expect(buf.side).toBeInstanceOf(Uint8Array);
    expect(buf.timestampNs[99]).toBe(99000);
    expect(buf.priceTicks[99]).toBe(5099);
    expect(buf.side[1]).toBe(SIDE_ASK);
  });

  it('keeps nanosecond timestamps exact across a full trading day', () => {
    const buf = new EventBuffer(2);
    const endOfDay = 86_400 * 1_000_000_000 - 1;
    buf.push(endOfDay, EV_NEW_LIMIT_ORDER, SIDE_BID, 1, 1, 1);
    expect(buf.timestampNs[0]).toBe(endOfDay);
    expect(Number.isSafeInteger(endOfDay)).toBe(true);
  });
});

describe('growable vectors', () => {
  it('grow and expose a zero-copy view of exactly the written prefix', () => {
    const f = new F64Vec(1);
    const i = new I32Vec(1);
    for (let k = 0; k < 10; k++) {
      f.push(k + 0.5);
      i.push(k);
    }
    expect(f.view().length).toBe(10);
    expect(i.view().length).toBe(10);
    expect(f.at(9)).toBe(9.5);
    expect(Array.from(i.view())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
