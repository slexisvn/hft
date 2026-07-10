export class F64Vec {
  private buf: Float64Array;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Float64Array(Math.max(1, initialCapacity));
  }

  get length(): number {
    return this.len;
  }

  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Float64Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }

  at(i: number): number {
    return this.buf[i];
  }

  view(): Float64Array {
    return this.buf.subarray(0, this.len);
  }
}

export class I32Vec {
  private buf: Int32Array;
  private len = 0;

  constructor(initialCapacity = 64) {
    this.buf = new Int32Array(Math.max(1, initialCapacity));
  }

  get length(): number {
    return this.len;
  }

  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = new Int32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }

  at(i: number): number {
    return this.buf[i];
  }

  view(): Int32Array {
    return this.buf.subarray(0, this.len);
  }
}
