import { describe, expect, it } from 'vitest';
import { SIDE_ASK, SIDE_BID, type OrderRequest } from '@hft/contracts';
import { createTickScale } from '@hft/events';
import {
  BinanceRestClient,
  BinanceRestTransport,
  encodeQuery,
  orderParams,
  signQuery,
  type HttpClient,
  type HttpRequestOptions,
} from '@hft/binance';

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

const SCALE = createTickScale(0.01, 100);
const SPEC = { symbol: 'BTCUSDT', pricePrecision: 2, quantityPrecision: 3, lotSize: 1 };

function req(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return { clientOrderId: 'c-1', side: SIDE_BID, priceTicks: 5000, size: 2, postOnly: true, ...overrides };
}

function capturingClient(status = 200, body = '{}'): { calls: HttpRequestOptions[]; client: HttpClient } {
  const calls: HttpRequestOptions[] = [];
  return {
    calls,
    client: (options) => {
      calls.push(options);
      return Promise.resolve({ status, body });
    },
  };
}

describe('binance rest signing', () => {
  it('signs a query with HMAC-SHA256 hex', () => {
    expect(signQuery('secret', 'symbol=BTCUSDT&side=BUY')).toBe(
      '83ef3517b61b829b8755e0f6dcff8b6b1c29f47ae72076ecd2aee6237ffbc10f',
    );
  });

  it('url-encodes query values', () => {
    expect(encodeQuery([['a', 'x y'], ['b', 1]])).toBe('a=x%20y&b=1');
  });

  it('requests server time from the public time endpoint without signing', async () => {
    const cap = capturingClient(200, '{"serverTime":1700000000000}');
    const client = new BinanceRestClient('https://api.binance.com', { apiKey: 'k', apiSecret: 's' }, { http: cap.client });
    await client.getServerTime();
    expect(cap.calls[0].method).toBe('GET');
    expect(cap.calls[0].url).toBe('https://api.binance.com/api/v3/time');
    expect(cap.calls[0].headers['X-MBX-APIKEY']).toBeUndefined();
  });

  it('appends recvWindow, timestamp and signature to a signed url', () => {
    const client = new BinanceRestClient(
      'https://api.binance.com',
      { apiKey: 'k', apiSecret: 'secret' },
      { now: () => 1700000000000 },
    );
    const url = client.signedUrl('/api/v3/order', [['symbol', 'BTCUSDT']]);
    expect(url).toContain('recvWindow=5000');
    expect(url).toContain('timestamp=1700000000000');
    expect(url).toMatch(/&signature=[0-9a-f]{64}$/);
  });
});

describe('binance order params', () => {
  it('maps a passive buy to a LIMIT_MAKER order without time-in-force', () => {
    const params = orderParams(SPEC, SCALE, req({ side: SIDE_BID, postOnly: true }));
    const map = new Map(params.map(([k, v]) => [k, String(v)]));
    expect(map.get('side')).toBe('BUY');
    expect(map.get('type')).toBe('LIMIT_MAKER');
    expect(map.get('price')).toBe('50.00');
    expect(map.get('quantity')).toBe('2.000');
    expect(map.has('timeInForce')).toBe(false);
  });

  it('maps an aggressive sell to a GTC LIMIT order', () => {
    const params = orderParams(SPEC, SCALE, req({ side: SIDE_ASK, postOnly: false }));
    const map = new Map(params.map(([k, v]) => [k, String(v)]));
    expect(map.get('side')).toBe('SELL');
    expect(map.get('type')).toBe('LIMIT');
    expect(map.get('timeInForce')).toBe('GTC');
  });
});

describe('binance rest transport', () => {
  it('posts a signed order carrying the client order id and the api key header', async () => {
    const cap = capturingClient();
    const client = new BinanceRestClient('https://api.binance.com', { apiKey: 'my-key', apiSecret: 'secret' });
    const errors: string[] = [];
    const transport = new BinanceRestTransport(
      new BinanceRestClient('https://api.binance.com', { apiKey: 'my-key', apiSecret: 'secret' }, { http: cap.client }),
      SCALE,
      SPEC,
      { onError: (id, e) => errors.push(`${id}:${e.message}`) },
    );
    transport.sendOrder(req({ clientOrderId: 'abc' }));
    await flush();
    void client;
    expect(cap.calls.length).toBe(1);
    expect(cap.calls[0].method).toBe('POST');
    expect(cap.calls[0].url).toContain('/api/v3/order');
    expect(cap.calls[0].url).toContain('newClientOrderId=abc');
    expect(cap.calls[0].headers['X-MBX-APIKEY']).toBe('my-key');
    expect(errors).toEqual([]);
  });

  it('reports an error when the exchange rejects the order', async () => {
    const cap = capturingClient(400, '{"code":-2010}');
    const errors: string[] = [];
    const transport = new BinanceRestTransport(
      new BinanceRestClient('https://api.binance.com', { apiKey: 'k', apiSecret: 's' }, { http: cap.client }),
      SCALE,
      SPEC,
      { onError: (id, e) => errors.push(`${id}:${e.message}`) },
    );
    transport.cancelOrder('gone');
    await flush();
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('binance rest 400');
  });
});
