import { SIDE_BID, type OrderRequest } from '@hft/contracts';
import { ticksToPrice, type TickScale } from '@hft/events';
import { BinanceRestClient, type HttpResponse, type QueryParams } from './rest';
import type { OrderTransport } from './transport';

export interface BinanceInstrumentSpec {
  readonly symbol: string;
  readonly pricePrecision: number;
  readonly quantityPrecision: number;
  readonly lotSize: number;
}

export interface BinanceTransportHooks {
  onError(clientOrderId: string, error: Error): void;
}

export function orderParams(
  spec: BinanceInstrumentSpec,
  scale: TickScale,
  request: OrderRequest,
): QueryParams {
  const price = ticksToPrice(scale, request.priceTicks).toFixed(spec.pricePrecision);
  const quantity = (request.size * spec.lotSize).toFixed(spec.quantityPrecision);
  const base: (readonly [string, string | number])[] = [
    ['symbol', spec.symbol],
    ['side', request.side === SIDE_BID ? 'BUY' : 'SELL'],
    ['type', request.postOnly ? 'LIMIT_MAKER' : 'LIMIT'],
    ['quantity', quantity],
    ['price', price],
    ['newClientOrderId', request.clientOrderId],
  ];
  if (!request.postOnly) base.push(['timeInForce', 'GTC']);
  return base;
}

export class BinanceRestTransport implements OrderTransport {
  readonly name = 'binance-rest';
  private readonly client: BinanceRestClient;
  private readonly scale: TickScale;
  private readonly spec: BinanceInstrumentSpec;
  private readonly hooks: BinanceTransportHooks;

  constructor(client: BinanceRestClient, scale: TickScale, spec: BinanceInstrumentSpec, hooks: BinanceTransportHooks) {
    this.client = client;
    this.scale = scale;
    this.spec = spec;
    this.hooks = hooks;
  }

  sendOrder(request: OrderRequest): void {
    this.client
      .signedRequest('POST', '/api/v3/order', orderParams(this.spec, this.scale, request))
      .then((res) => this.check(request.clientOrderId, res))
      .catch((err: Error) => this.hooks.onError(request.clientOrderId, err));
  }

  cancelOrder(clientOrderId: string): void {
    this.client
      .signedRequest('DELETE', '/api/v3/order', [
        ['symbol', this.spec.symbol],
        ['origClientOrderId', clientOrderId],
      ])
      .then((res) => this.check(clientOrderId, res))
      .catch((err: Error) => this.hooks.onError(clientOrderId, err));
  }

  private check(clientOrderId: string, res: HttpResponse): void {
    if (res.status < 200 || res.status >= 300) {
      this.hooks.onError(clientOrderId, new Error(`binance rest ${res.status}: ${res.body}`));
    }
  }
}
