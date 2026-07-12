import { createHmac } from 'node:crypto';
import { request as httpsRequest } from 'node:https';

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface HttpRequestOptions {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export type HttpClient = (options: HttpRequestOptions) => Promise<HttpResponse>;

export type QueryParams = readonly (readonly [string, string | number])[];

export function encodeQuery(params: QueryParams): string {
  const parts: string[] = [];
  for (const [key, value] of params) parts.push(`${key}=${encodeURIComponent(String(value))}`);
  return parts.join('&');
}

export function signQuery(secret: string, query: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}

const nodeHttpsClient: HttpClient = (options) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(options.url, { method: options.method, headers: options.headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });

export interface BinanceCredentials {
  readonly apiKey: string;
  readonly apiSecret: string;
}

export class BinanceRestClient {
  private readonly restEndpoint: string;
  private readonly credentials: BinanceCredentials;
  private readonly http: HttpClient;
  private readonly now: () => number;
  private readonly recvWindowMs: number;

  constructor(
    restEndpoint: string,
    credentials: BinanceCredentials,
    options: { http?: HttpClient; now?: () => number; recvWindowMs?: number } = {},
  ) {
    this.restEndpoint = restEndpoint;
    this.credentials = credentials;
    this.http = options.http ?? nodeHttpsClient;
    this.now = options.now ?? (() => Date.now());
    this.recvWindowMs = options.recvWindowMs ?? 5000;
  }

  signedUrl(path: string, params: QueryParams): string {
    const withTiming: (readonly [string, string | number])[] = [
      ...params,
      ['recvWindow', this.recvWindowMs],
      ['timestamp', this.now()],
    ];
    const query = encodeQuery(withTiming);
    const signature = signQuery(this.credentials.apiSecret, query);
    return `${this.restEndpoint}${path}?${query}&signature=${signature}`;
  }

  async signedRequest(method: string, path: string, params: QueryParams): Promise<HttpResponse> {
    return this.http({
      method,
      url: this.signedUrl(path, params),
      headers: { 'X-MBX-APIKEY': this.credentials.apiKey },
    });
  }

  async publicRequest(method: string, path: string, params: QueryParams): Promise<HttpResponse> {
    const query = encodeQuery(params);
    const url = query.length === 0 ? `${this.restEndpoint}${path}` : `${this.restEndpoint}${path}?${query}`;
    return this.http({ method, url, headers: {} });
  }

  private async apiKeyRequest(method: string, path: string, params: QueryParams): Promise<HttpResponse> {
    const query = encodeQuery(params);
    const url = query.length === 0 ? `${this.restEndpoint}${path}` : `${this.restEndpoint}${path}?${query}`;
    return this.http({ method, url, headers: { 'X-MBX-APIKEY': this.credentials.apiKey } });
  }

  getAccount(): Promise<HttpResponse> {
    return this.signedRequest('GET', '/api/v3/account', []);
  }

  getOpenOrders(symbol: string): Promise<HttpResponse> {
    return this.signedRequest('GET', '/api/v3/openOrders', [['symbol', symbol]]);
  }

  getServerTime(): Promise<HttpResponse> {
    return this.publicRequest('GET', '/api/v3/time', []);
  }

  getDepthSnapshot(symbol: string, limit: number): Promise<HttpResponse> {
    return this.publicRequest('GET', '/api/v3/depth', [
      ['symbol', symbol],
      ['limit', limit],
    ]);
  }

  createListenKey(): Promise<HttpResponse> {
    return this.apiKeyRequest('POST', '/api/v3/userDataStream', []);
  }

  keepAliveListenKey(listenKey: string): Promise<HttpResponse> {
    return this.apiKeyRequest('PUT', '/api/v3/userDataStream', [['listenKey', listenKey]]);
  }
}
