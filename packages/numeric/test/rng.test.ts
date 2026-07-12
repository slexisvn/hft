import { describe, expect, it } from 'vitest';
import { Rng } from '@hft/numeric';

function draws(seed: number, n: number): number[] {
  const rng = new Rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.nextUnit());
  return out;
}

describe('Rng', () => {
  it('is deterministic for a fixed seed', () => {
    expect(draws(42, 8)).toEqual(draws(42, 8));
  });

  it('produces different streams for different seeds', () => {
    expect(draws(1, 8)).not.toEqual(draws(2, 8));
  });

  it('stays within the unit interval', () => {
    for (const u of draws(20260710, 1000)) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('has an approximately zero-mean unit-variance normal draw', () => {
    const rng = new Rng(7);
    let sum = 0;
    let sumSq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const z = rng.nextNormal();
      sum += z;
      sumSq += z * z;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sumSq / n - 1)).toBeLessThan(0.05);
  });
});
