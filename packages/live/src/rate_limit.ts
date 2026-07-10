import { InvariantError, NANOS_PER_SECOND, type Clock } from '@hft/contracts';

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly clock: Clock;
  private tokens: number;
  private lastNs: number;

  constructor(capacity: number, refillPerSecond: number, clock: Clock) {
    if (capacity <= 0) throw new InvariantError('token bucket capacity must be positive');
    if (refillPerSecond <= 0) throw new InvariantError('token bucket refill rate must be positive');
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.clock = clock;
    this.tokens = capacity;
    this.lastNs = clock.now();
  }

  get available(): number {
    return this.tokens;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastNs;
    if (elapsed <= 0) return;
    this.lastNs = now;
    const gained = (elapsed / NANOS_PER_SECOND) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + gained);
  }

  tryAcquire(count = 1): boolean {
    this.refill();
    if (this.tokens < count) return false;
    this.tokens -= count;
    return true;
  }

  nanosUntilAvailable(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const deficit = count - this.tokens;
    return Math.ceil((deficit / this.refillPerSecond) * NANOS_PER_SECOND);
  }
}
