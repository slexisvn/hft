import { describe, expect, it } from 'vitest';
import { Rng } from '@hft/numeric';
import { constantLatency, empiricalLatency, lognormalLatency } from '@hft/sim';

describe('latency samplers', () => {
  it('constant always returns the same value', () => {
    const s = constantLatency(1234);
    expect([s(), s(), s()]).toEqual([1234, 1234, 1234]);
  });

  it('lognormal with sigma 0 collapses to the median', () => {
    const s = lognormalLatency(1000, 0, new Rng(1));
    expect([s(), s()]).toEqual([1000, 1000]);
  });

  it('lognormal is deterministic for a fixed seed and centred on the median', () => {
    const a = lognormalLatency(1000, 0.5, new Rng(9));
    const b = lognormalLatency(1000, 0.5, new Rng(9));
    const draws: number[] = [];
    let sum = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) {
      const va = a();
      expect(va).toBe(b());
      expect(va).toBeGreaterThanOrEqual(0);
      if (draws.length < 5) draws.push(va);
      sum += va;
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(1000);
    expect(mean).toBeLessThan(1000 * Math.exp(0.5 * 0.5) * 1.1);
  });

  it('empirical draws only from the provided samples, deterministically', () => {
    const samples = [10, 20, 30];
    const a = empiricalLatency(samples, new Rng(3));
    const b = empiricalLatency(samples, new Rng(3));
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(samples).toContain(v);
      expect(v).toBe(b());
    }
  });

  it('rejects an empty empirical sample set', () => {
    expect(() => empiricalLatency([], new Rng(1))).toThrowError(/at least one sample/);
  });
});
