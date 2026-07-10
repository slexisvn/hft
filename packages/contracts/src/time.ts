export type Nanos = number;

export const NANOS_PER_MICRO = 1_000;
export const NANOS_PER_MILLI = 1_000_000;
export const NANOS_PER_SECOND = 1_000_000_000;
export const NANOS_PER_DAY = 86_400 * NANOS_PER_SECOND;

export interface Clock {
  now(): Nanos;
}

export type TimerId = number;

export interface SchedulingClock extends Clock {
  schedule(atNs: Nanos, callback: () => void): TimerId;
  cancelTimer(id: TimerId): void;
}

export function isRepresentableNanos(ns: number): boolean {
  return Number.isFinite(ns) && Number.isInteger(ns) && ns >= 0 && ns <= Number.MAX_SAFE_INTEGER;
}
