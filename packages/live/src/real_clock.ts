import { performance } from 'node:perf_hooks';
import {
  NANOS_PER_MILLI,
  type Clock,
  type Nanos,
  type SchedulingClock,
  type TimerId,
} from '@hft/contracts';

export class RealClock implements Clock {
  private readonly baseNanosFromMidnight: number;
  private readonly basePerfMs: number;

  constructor(nowMs: number = Date.now(), perfMs: number = performance.now()) {
    const date = new Date(nowMs);
    const msFromMidnightUtc =
      date.getUTCHours() * 3600000 +
      date.getUTCMinutes() * 60000 +
      date.getUTCSeconds() * 1000 +
      date.getUTCMilliseconds();
    this.baseNanosFromMidnight = msFromMidnightUtc * NANOS_PER_MILLI;
    this.basePerfMs = perfMs;
  }

  now(): Nanos {
    const elapsedMs = performance.now() - this.basePerfMs;
    return Math.round(this.baseNanosFromMidnight + elapsedMs * NANOS_PER_MILLI);
  }
}

export class RealSchedulingClock implements SchedulingClock {
  private readonly clock: Clock;
  private readonly timers = new Map<TimerId, unknown>();
  private seq = 0;

  constructor(clock: Clock = new RealClock()) {
    this.clock = clock;
  }

  now(): Nanos {
    return this.clock.now();
  }

  schedule(atNs: Nanos, callback: () => void): TimerId {
    const id = this.seq++;
    const delayMs = Math.max(0, (atNs - this.now()) / NANOS_PER_MILLI);
    const handle = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, delayMs);
    handle.unref();
    this.timers.set(id, handle);
    return id;
  }

  cancelTimer(id: TimerId): void {
    const handle = this.timers.get(id);
    if (handle === undefined) return;
    clearTimeout(handle);
    this.timers.delete(id);
  }

  get pendingTimerCount(): number {
    return this.timers.size;
  }
}
