import type { EventColumns, EventType, Side } from '@hft/contracts';

export class EventBuffer implements EventColumns {
  private cap: number;
  private len = 0;
  private ts: Float64Array;
  private et: Uint8Array;
  private sd: Uint8Array;
  private oid: Int32Array;
  private sz: Int32Array;
  private px: Int32Array;

  constructor(initialCapacity: number) {
    this.cap = Math.max(1, initialCapacity);
    this.ts = new Float64Array(this.cap);
    this.et = new Uint8Array(this.cap);
    this.sd = new Uint8Array(this.cap);
    this.oid = new Int32Array(this.cap);
    this.sz = new Int32Array(this.cap);
    this.px = new Int32Array(this.cap);
  }

  get length(): number {
    return this.len;
  }
  get timestampNs(): Float64Array {
    return this.ts.subarray(0, this.len);
  }
  get eventType(): Uint8Array {
    return this.et.subarray(0, this.len);
  }
  get side(): Uint8Array {
    return this.sd.subarray(0, this.len);
  }
  get orderId(): Int32Array {
    return this.oid.subarray(0, this.len);
  }
  get sizeQty(): Int32Array {
    return this.sz.subarray(0, this.len);
  }
  get priceTicks(): Int32Array {
    return this.px.subarray(0, this.len);
  }

  push(timestampNs: number, eventType: EventType, side: Side, orderId: number, sizeQty: number, priceTicks: number): void {
    if (this.len === this.cap) this.grow();
    const i = this.len;
    this.ts[i] = timestampNs;
    this.et[i] = eventType;
    this.sd[i] = side;
    this.oid[i] = orderId;
    this.sz[i] = sizeQty;
    this.px[i] = priceTicks;
    this.len = i + 1;
  }

  private grow(): void {
    const next = this.cap * 2;
    this.ts = growF64(this.ts, next);
    this.et = growU8(this.et, next);
    this.sd = growU8(this.sd, next);
    this.oid = growI32(this.oid, next);
    this.sz = growI32(this.sz, next);
    this.px = growI32(this.px, next);
    this.cap = next;
  }
}

function growF64(a: Float64Array, n: number): Float64Array {
  const b = new Float64Array(n);
  b.set(a);
  return b;
}
function growU8(a: Uint8Array, n: number): Uint8Array {
  const b = new Uint8Array(n);
  b.set(a);
  return b;
}
function growI32(a: Int32Array, n: number): Int32Array {
  const b = new Int32Array(n);
  b.set(a);
  return b;
}
