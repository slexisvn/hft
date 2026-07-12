import { describe, expect, it } from 'vitest';
import { NANOS_PER_DAY } from '@hft/contracts';
import { RealClock, RealSchedulingClock } from '@hft/live';

function controllablePerf(): { advance(ms: number): void; perf: () => number } {
  let p = 0;
  return { advance: (ms) => (p += ms), perf: () => p };
}

describe('RealClock', () => {
  it('advances nanos-from-midnight with the perf clock', () => {
    const c = controllablePerf();
    const clock = new RealClock(Date.UTC(2026, 6, 10, 0, 0, 1), c.perf);
    c.advance(500);
    expect(clock.now()).toBe(1_500_000_000);
  });

  it('resync re-anchors, correcting perf drift and applying exchange server time', () => {
    const c = controllablePerf();
    const clock = new RealClock(Date.UTC(2026, 6, 10, 0, 0, 1), c.perf);
    c.advance(100_000);
    clock.resync(Date.UTC(2026, 6, 10, 0, 0, 2));
    c.advance(500);
    expect(clock.now()).toBe(2_500_000_000);
  });

  it('wraps the wall clock across the UTC midnight rollover', () => {
    const c = controllablePerf();
    const clock = new RealClock(Date.UTC(2026, 6, 10, 23, 59, 59, 999), c.perf);
    c.advance(2);
    expect(clock.now()).toBeGreaterThan(NANOS_PER_DAY);
    expect(clock.wallNanosFromMidnight()).toBe(1_000_000);
  });
});

describe('RealSchedulingClock', () => {
  it('applies an exchange server-time resync to its underlying real clock', () => {
    const c = controllablePerf();
    const scheduling = new RealSchedulingClock(new RealClock(Date.UTC(2026, 6, 10, 0, 0, 1), c.perf));
    c.advance(50);
    scheduling.resync(Date.UTC(2026, 6, 10, 0, 0, 5));
    expect(scheduling.now()).toBe(5_000_000_000);
  });
});
