import { InvariantError, type Gateway, type OrderRequest, type Side } from '@hft/contracts';

export function formatClientOrderId(prefix: string, epoch: number, side: Side, seq: number): string {
  return `${prefix}.${epoch}.${side}.${seq}`;
}

export class ClientOrderIdGenerator {
  private readonly prefix: string;
  private readonly epoch: number;
  private seq: number;

  constructor(prefix: string, epoch: number, startSeq = 0) {
    if (prefix.indexOf('.') >= 0) throw new InvariantError('client order id prefix must not contain "."');
    this.prefix = prefix;
    this.epoch = epoch;
    this.seq = startSeq;
  }

  get nextSeq(): number {
    return this.seq;
  }

  restore(seq: number): void {
    if (seq < this.seq) throw new InvariantError(`cannot rewind client order id sequence ${this.seq} -> ${seq}`);
    this.seq = seq;
  }

  next(side: Side): string {
    return formatClientOrderId(this.prefix, this.epoch, side, this.seq++);
  }

  at(side: Side, seq: number): string {
    return formatClientOrderId(this.prefix, this.epoch, side, seq);
  }
}

export class IdempotentSubmitter {
  private readonly gateway: Gateway;
  private readonly sent = new Set<string>();

  constructor(gateway: Gateway) {
    this.gateway = gateway;
  }

  get sentCount(): number {
    return this.sent.size;
  }

  wasSent(clientOrderId: string): boolean {
    return this.sent.has(clientOrderId);
  }

  submit(request: OrderRequest): boolean {
    if (this.sent.has(request.clientOrderId)) return false;
    this.sent.add(request.clientOrderId);
    this.gateway.submit(request);
    return true;
  }

  forget(clientOrderId: string): void {
    this.sent.delete(clientOrderId);
  }
}
