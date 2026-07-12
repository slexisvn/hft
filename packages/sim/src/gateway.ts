import {
  InvariantError,
  type BookView,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
} from '@hft/contracts';

export interface GatewayBackend {
  onSubmit(request: OrderRequest, submittedAtNs: number): void;
  onCancel(clientOrderId: string, submittedAtNs: number): void;
  onAmend(clientOrderId: string, newSize: number, submittedAtNs: number): void;
  snapshots(): readonly OrderSnapshot[];
  netPosition(): number;
  view(): BookView;
}

export class SimGateway implements Gateway {
  private readonly backend: GatewayBackend;
  private readonly nowNs: () => number;
  private submitted = 0;
  private readonly seen = new Set<string>();

  constructor(backend: GatewayBackend, nowNs: () => number) {
    this.backend = backend;
    this.nowNs = nowNs;
  }

  get submissionCount(): number {
    return this.submitted;
  }

  submit(request: OrderRequest): void {
    if (request.size <= 0 || !Number.isInteger(request.size)) {
      throw new InvariantError(`order size must be a positive integer, got ${request.size}`);
    }
    if (this.seen.has(request.clientOrderId)) {
      throw new InvariantError(`client order id "${request.clientOrderId}" reused`);
    }
    this.seen.add(request.clientOrderId);
    this.submitted++;
    this.backend.onSubmit(request, this.nowNs());
  }

  cancel(clientOrderId: string): void {
    this.backend.onCancel(clientOrderId, this.nowNs());
  }

  amend(clientOrderId: string, newSize: number): void {
    this.backend.onAmend(clientOrderId, newSize, this.nowNs());
  }

  openOrders(): readonly OrderSnapshot[] {
    return this.backend.snapshots();
  }

  position(): number {
    return this.backend.netPosition();
  }

  marketView(): BookView {
    return this.backend.view();
  }
}
