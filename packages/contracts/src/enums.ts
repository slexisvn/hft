export type Ticks = number;

export type Side = 0 | 1;
export const SIDE_BID: Side = 0;
export const SIDE_ASK: Side = 1;

export function oppositeSide(side: Side): Side {
  return side === SIDE_BID ? SIDE_ASK : SIDE_BID;
}

export function sideName(side: Side): 'bid' | 'ask' {
  return side === SIDE_BID ? 'bid' : 'ask';
}

export type EventType = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const EV_NEW_LIMIT_ORDER: EventType = 1;
export const EV_PARTIAL_CANCEL: EventType = 2;
export const EV_TOTAL_DELETE: EventType = 3;
export const EV_EXECUTE_VISIBLE: EventType = 4;
export const EV_EXECUTE_HIDDEN: EventType = 5;
export const EV_CROSS_TRADE: EventType = 6;
export const EV_TRADING_HALT: EventType = 7;

export type Liquidity = 0 | 1;
export const LIQ_MAKER: Liquidity = 0;
export const LIQ_TAKER: Liquidity = 1;

export const NO_PRICE = -1;

export type CursorId = number;
