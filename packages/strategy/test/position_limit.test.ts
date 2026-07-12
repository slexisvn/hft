import { describe, expect, it } from 'vitest';
import {
  SIDE_ASK,
  SIDE_BID,
  type BookView,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
  type Side,
} from '@hft/contracts';
import { TwoSidedQuoter, defaultIdFactory } from '@hft/strategy';

class FakeGateway implements Gateway {
  readonly submitted: OrderRequest[] = [];
  readonly canceled: string[] = [];
  readonly amended: { clientOrderId: string; newSize: number }[] = [];
  open: OrderSnapshot[] = [];
  pos = 0;

  submit(request: OrderRequest): void {
    this.submitted.push(request);
    this.open.push({
      clientOrderId: request.clientOrderId,
      side: request.side,
      priceTicks: request.priceTicks,
      size: request.size,
      remaining: request.size,
      state: 'acked',
    });
  }
  cancel(clientOrderId: string): void {
    this.canceled.push(clientOrderId);
    this.open = this.open.filter((o) => o.clientOrderId !== clientOrderId);
  }
  amend(clientOrderId: string, newSize: number): void {
    this.amended.push({ clientOrderId, newSize });
  }
  openOrders(): readonly OrderSnapshot[] {
    return this.open;
  }
  position(): number {
    return this.pos;
  }
  marketView(): BookView {
    throw new Error('not used');
  }
}

function quoter(): TwoSidedQuoter {
  return new TwoSidedQuoter(defaultIdFactory('t'), 1);
}

function desire(q: TwoSidedQuoter, g: FakeGateway, side: Side, price: number, size: number, max: number): void {
  q.desireWithinPosition(g, side, price, size, g.position(), max);
}

describe('position limit at the strategy layer', () => {
  it('quotes both sides when flat', () => {
    const g = new FakeGateway();
    const q = quoter();
    desire(q, g, SIDE_BID, 100, 10, 20);
    desire(q, g, SIDE_ASK, 101, 10, 20);
    expect(g.submitted.length).toBe(2);
  });

  it('amends down in place at a stable price instead of cancel-replacing, keeping queue priority', () => {
    const g = new FakeGateway();
    const q = quoter();
    desire(q, g, SIDE_BID, 100, 10, 1000);
    expect(g.submitted.length).toBe(1);
    desire(q, g, SIDE_BID, 100, 4, 1000);
    expect(g.amended).toEqual([{ clientOrderId: g.submitted[0].clientOrderId, newSize: 4 }]);
    expect(g.submitted.length).toBe(1);
    expect(g.canceled).toEqual([]);
  });

  it('withdraws the bid once buying more would breach the long limit', () => {
    const g = new FakeGateway();
    const q = quoter();
    g.pos = 15;
    desire(q, g, SIDE_BID, 100, 10, 20);
    expect(g.submitted.length).toBe(0);
    desire(q, g, SIDE_ASK, 101, 10, 20);
    expect(g.submitted.length).toBe(1);
    expect(g.submitted[0].side).toBe(SIDE_ASK);
  });

  it('withdraws the ask once selling more would breach the short limit', () => {
    const g = new FakeGateway();
    const q = quoter();
    g.pos = -15;
    desire(q, g, SIDE_ASK, 101, 10, 20);
    expect(g.submitted.length).toBe(0);
  });

  it('cancels a resting quote when the limit is breached after a fill', () => {
    const g = new FakeGateway();
    const q = quoter();
    desire(q, g, SIDE_BID, 100, 10, 20);
    expect(g.openOrders().length).toBe(1);
    g.pos = 15;
    desire(q, g, SIDE_BID, 99, 10, 20);
    expect(g.canceled.length).toBe(1);
    expect(g.openOrders().length).toBe(0);
  });

  it('counts working size on the same side, not just the settled position', () => {
    const g = new FakeGateway();
    const q = quoter();
    g.open.push({
      clientOrderId: 'other',
      side: SIDE_BID,
      priceTicks: 100,
      size: 15,
      remaining: 15,
      state: 'acked',
    });
    desire(q, g, SIDE_BID, 100, 10, 20);
    expect(g.submitted.length).toBe(0);
  });
});
