import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  SIDE_ASK,
  SIDE_BID,
  type EventColumns,
  type EventType,
  type Side,
} from '@hft/contracts';
import { EventBuffer } from '@hft/events';

export interface Decision {
  readonly kind: 'submit' | 'cancel';
  readonly clientOrderId: string;
  readonly side?: Side;
  readonly priceTicks?: number;
  readonly size?: number;
}

export function buildEvents(): EventColumns {
  const b = new EventBuffer(64);
  const ms = 1_000_000;
  let id = 1;
  b.push(0, EV_NEW_LIMIT_ORDER, SIDE_BID, id++, 100, 1000);
  b.push(1 * ms, EV_NEW_LIMIT_ORDER, SIDE_ASK, id++, 100, 1002);
  b.push(2 * ms, EV_NEW_LIMIT_ORDER, SIDE_BID, id++, 200, 999);
  b.push(3 * ms, EV_NEW_LIMIT_ORDER, SIDE_ASK, id++, 150, 1003);
  b.push(10 * ms, EV_NEW_LIMIT_ORDER, SIDE_BID, id++, 50, 1000);
  b.push(20 * ms, EV_EXECUTE_VISIBLE, SIDE_BID, 1, 100, 1000);
  b.push(30 * ms, EV_NEW_LIMIT_ORDER, SIDE_ASK, id++, 80, 1002);
  b.push(40 * ms, EV_EXECUTE_VISIBLE, SIDE_ASK, 2, 100, 1002);
  b.push(50 * ms, EV_NEW_LIMIT_ORDER, SIDE_BID, id++, 300, 1001);
  b.push(60 * ms, EV_EXECUTE_VISIBLE, SIDE_BID, 5, 50, 1000);
  b.push(70 * ms, EV_NEW_LIMIT_ORDER, SIDE_ASK, id++, 120, 1004);
  b.push(80 * ms, EV_EXECUTE_VISIBLE, SIDE_BID, 7, 300, 1001);
  b.push(90 * ms, EV_NEW_LIMIT_ORDER, SIDE_BID, id++, 90, 1001);
  b.push(100 * ms, EV_EXECUTE_VISIBLE, SIDE_ASK, 4, 150, 1003);
  return b;
}

export function eventAt(events: EventColumns, i: number): {
  ts: number;
  type: EventType;
  orderId: number;
  side: Side;
  priceTicks: number;
  size: number;
} {
  return {
    ts: events.timestampNs[i],
    type: events.eventType[i] as EventType,
    orderId: events.orderId[i],
    side: events.side[i] as Side,
    priceTicks: events.priceTicks[i],
    size: events.sizeQty[i],
  };
}
