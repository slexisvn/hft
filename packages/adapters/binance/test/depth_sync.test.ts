import { describe, expect, it } from 'vitest';
import { ConfigError, SIDE_ASK, SIDE_BID } from '@hft/contracts';
import { createTickScale } from '@hft/events';
import { DepthSynchronizer, normalizeDepthUpdate, type BinanceDepthUpdate, type NormalizedLevelUpdate } from '@hft/binance';

function update(firstUpdateId: number, finalUpdateId: number): BinanceDepthUpdate {
  return { firstUpdateId, finalUpdateId, bids: [], asks: [] };
}

describe('Binance depth stream synchronisation', () => {
  it('buffers events until the snapshot arrives', () => {
    const s = new DepthSynchronizer();
    expect(s.accept(update(1, 5))).toBe('buffered');
    expect(s.accept(update(6, 9))).toBe('buffered');
    expect(s.syncState).toBe('buffering');
    expect(s.bufferedCount).toBe(2);
  });

  it('discards buffered events already contained in the snapshot', () => {
    const s = new DepthSynchronizer();
    s.accept(update(1, 5));
    s.accept(update(6, 9));
    s.accept(update(10, 14));
    const pending = s.applySnapshot(9);
    expect(pending.map((u) => u.finalUpdateId)).toEqual([14]);
    expect(s.syncState).toBe('synced');
    expect(s.lastAppliedUpdateId).toBe(14);
  });

  it('accepts the first event that straddles the snapshot id', () => {
    const s = new DepthSynchronizer();
    s.accept(update(1, 5));
    s.accept(update(6, 12));
    const pending = s.applySnapshot(9);
    expect(pending.map((u) => u.firstUpdateId)).toEqual([6]);
    expect(s.lastAppliedUpdateId).toBe(12);
  });

  it('demands a resync when the buffer starts after the snapshot leaves a hole', () => {
    const s = new DepthSynchronizer();
    s.accept(update(20, 25));
    expect(s.applySnapshot(9)).toEqual([]);
    expect(s.syncState).toBe('resync_required');
  });

  it('demands a resync when the buffered events themselves have a hole', () => {
    const s = new DepthSynchronizer();
    s.accept(update(10, 14));
    s.accept(update(20, 25));
    expect(s.applySnapshot(9)).toEqual([]);
    expect(s.syncState).toBe('resync_required');
  });

  it('syncs on an empty buffer when the snapshot is newer than every event', () => {
    const s = new DepthSynchronizer();
    s.accept(update(1, 5));
    expect(s.applySnapshot(100)).toEqual([]);
    expect(s.syncState).toBe('synced');
    expect(s.lastAppliedUpdateId).toBe(100);
  });

  it('applies a contiguous live stream and discards stale repeats', () => {
    const s = new DepthSynchronizer();
    s.accept(update(10, 14));
    s.applySnapshot(9);
    expect(s.accept(update(15, 20))).toBe('applied');
    expect(s.accept(update(15, 20))).toBe('discarded');
    expect(s.accept(update(21, 21))).toBe('applied');
    expect(s.lastAppliedUpdateId).toBe(21);
  });

  it('flags a gap in the live stream instead of applying it', () => {
    const s = new DepthSynchronizer();
    s.accept(update(10, 14));
    s.applySnapshot(9);
    expect(s.accept(update(16, 20))).toBe('resync_required');
    expect(s.syncState).toBe('resync_required');
    expect(s.accept(update(21, 25))).toBe('resync_required');
  });

  it('returns to buffering after a reset', () => {
    const s = new DepthSynchronizer();
    s.accept(update(10, 14));
    s.applySnapshot(9);
    s.accept(update(16, 20));
    s.reset();
    expect(s.syncState).toBe('buffering');
    expect(s.resyncCount).toBe(1);
    expect(s.accept(update(30, 35))).toBe('buffered');
  });

  it('rejects a malformed update whose final id precedes its first id', () => {
    const s = new DepthSynchronizer();
    expect(() => s.accept(update(10, 9))).toThrowError(ConfigError);
  });
});

describe('depth update normalisation', () => {
  it('converts wire strings into integer ticks on both sides', () => {
    const scale = createTickScale(0.01, 10000);
    const out: NormalizedLevelUpdate[] = [];
    const n = normalizeDepthUpdate(
      { firstUpdateId: 1, finalUpdateId: 2, bids: [['100.01', '5']], asks: [['100.03', '7']] },
      scale,
      out,
    );
    expect(n).toBe(2);
    expect(out[0]).toEqual({ side: SIDE_BID, priceTicks: 10001, size: 5 });
    expect(out[1]).toEqual({ side: SIDE_ASK, priceTicks: 10003, size: 7 });
  });

  it('refuses a price that is not on the instrument tick grid', () => {
    const scale = createTickScale(0.01, 10000);
    expect(() =>
      normalizeDepthUpdate({ firstUpdateId: 1, finalUpdateId: 2, bids: [['100.015', '5']], asks: [] }, scale, []),
    ).toThrowError(ConfigError);
  });
});
