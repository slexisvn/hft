import { performance } from 'node:perf_hooks';
import {
  NANOS_PER_DAY,
  NANOS_PER_MILLI,
  type Clock,
  type Nanos,
  type SchedulingClock,
  type TimerId,
} from '@hft/contracts';

function nanosFromMidnightUtc(nowMs: number): number {
  const date = new Date(nowMs);
  const msFromMidnight =
    date.getUTCHours() * 3600000 +
    date.getUTCMinutes() * 60000 +
    date.getUTCSeconds() * 1000 +
    date.getUTCMilliseconds();
  return msFromMidnight * NANOS_PER_MILLI;
}

export class RealClock implements Clock {
  private baseNanosFromMidnight: number;
  private basePerfMs: number;
  private readonly perfNow: () => number;

  constructor(nowMs: number = Date.now(), perfNow: () => number = () => performance.now()) {
    this.perfNow = perfNow;
    this.baseNanosFromMidnight = nanosFromMidnightUtc(nowMs);
    this.basePerfMs = perfNow();
  }

  now(): Nanos {
    const elapsedMs = this.perfNow() - this.basePerfMs;
    return Math.round(this.baseNanosFromMidnight + elapsedMs * NANOS_PER_MILLI);
  }

  resync(nowMs: number): void {
    this.baseNanosFromMidnight = nanosFromMidnightUtc(nowMs);
    this.basePerfMs = this.perfNow();
  }

  wallNanosFromMidnight(): Nanos {
    return ((this.now() % NANOS_PER_DAY) + NANOS_PER_DAY) % NANOS_PER_DAY;
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

  resync(nowMs: number): void {
    if (this.clock instanceof RealClock) this.clock.resync(nowMs);
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
