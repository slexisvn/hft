import { InvariantError, type Nanos, type SchedulingClock, type TimerId } from '@hft/contracts';

export class SimClock implements SchedulingClock {
  private t = 0;
  private seq = 0;
  private readonly time: number[] = [];
  private readonly order: number[] = [];
  private readonly ids: number[] = [];
  private readonly callbacks = new Map<number, () => void>();

  now(): Nanos {
    return this.t;
  }

  schedule(atNs: Nanos, callback: () => void): TimerId {
    if (atNs < this.t) {
      throw new InvariantError(`cannot schedule at ${atNs}, clock is already at ${this.t}`);
    }
    const id = this.seq++;
    this.callbacks.set(id, callback);
    this.time.push(atNs);
    this.order.push(id);
    this.ids.push(id);
    this.siftUp(this.time.length - 1);
    return id;
  }

  cancelTimer(id: TimerId): void {
    this.callbacks.delete(id);
  }

  peekTime(): number {
    while (this.ids.length > 0 && !this.callbacks.has(this.ids[0])) this.popRaw();
    return this.ids.length === 0 ? Number.POSITIVE_INFINITY : this.time[0];
  }

  advanceTo(atNs: Nanos): void {
    if (atNs < this.t) throw new InvariantError(`clock cannot move backwards: ${this.t} -> ${atNs}`);
    this.t = atNs;
  }

  runNext(): boolean {
    const at = this.peekTime();
    if (!Number.isFinite(at)) return false;
    const id = this.ids[0];
    const cb = this.callbacks.get(id);
    this.popRaw();
    this.callbacks.delete(id);
    this.advanceTo(at);
    if (cb !== undefined) cb();
    return true;
  }

  runUntil(atNs: Nanos): void {
    while (this.peekTime() <= atNs) this.runNext();
    this.advanceTo(atNs);
  }

  private popRaw(): void {
    const last = this.time.length - 1;
    this.swap(0, last);
    this.time.pop();
    this.order.pop();
    this.ids.pop();
    if (this.time.length > 0) this.siftDown(0);
  }

  private less(a: number, b: number): boolean {
    if (this.time[a] !== this.time[b]) return this.time[a] < this.time[b];
    return this.order[a] < this.order[b];
  }

  private swap(a: number, b: number): void {
    const t = this.time[a];
    this.time[a] = this.time[b];
    this.time[b] = t;
    const o = this.order[a];
    this.order[a] = this.order[b];
    this.order[b] = o;
    const i = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = i;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  private siftDown(i: number): void {
    const n = this.time.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
  }
}
