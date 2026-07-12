import { OrderStateError, type OrderState } from '@hft/contracts';

const ALLOWED: Readonly<Record<OrderState, readonly OrderState[]>> = Object.freeze({
  pending: ['acked', 'rejected', 'canceled'],
  acked: ['partial', 'filled', 'canceled', 'rejected'],
  partial: ['partial', 'filled', 'canceled'],
  filled: [],
  canceled: [],
  rejected: [],
});

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ALLOWED[from].indexOf(to) >= 0;
}

export function isTerminal(state: OrderState): boolean {
  return ALLOWED[state].length === 0;
}

export class OrderStateMachine {
  readonly clientOrderId: string;
  private current: OrderState;

  constructor(clientOrderId: string, initial: OrderState = 'pending') {
    this.clientOrderId = clientOrderId;
    this.current = initial;
  }

  get state(): OrderState {
    return this.current;
  }

  transition(to: OrderState): void {
    if (!canTransition(this.current, to)) {
      throw new OrderStateError(`order "${this.clientOrderId}": illegal transition ${this.current} -> ${to}`);
    }
    this.current = to;
  }
}

export class OrderRegistry {
  private readonly orders = new Map<string, OrderStateMachine>();

  create(clientOrderId: string): OrderStateMachine {
    if (this.orders.has(clientOrderId)) {
      throw new OrderStateError(`order "${clientOrderId}" already registered`);
    }
    const fsm = new OrderStateMachine(clientOrderId);
    this.orders.set(clientOrderId, fsm);
    return fsm;
  }

  restore(clientOrderId: string, state: OrderState): OrderStateMachine {
    const fsm = new OrderStateMachine(clientOrderId, state);
    this.orders.set(clientOrderId, fsm);
    return fsm;
  }

  get(clientOrderId: string): OrderStateMachine {
    const fsm = this.orders.get(clientOrderId);
    if (fsm === undefined) throw new OrderStateError(`unknown order "${clientOrderId}"`);
    return fsm;
  }

  has(clientOrderId: string): boolean {
    return this.orders.has(clientOrderId);
  }

  transition(clientOrderId: string, to: OrderState): void {
    this.get(clientOrderId).transition(to);
  }

  liveOrderIds(): string[] {
    const out: string[] = [];
    for (const [id, fsm] of this.orders) if (!isTerminal(fsm.state)) out.push(id);
    return out;
  }
}
