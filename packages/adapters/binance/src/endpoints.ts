import type { LiveConfig } from '@hft/contracts';

export interface BinanceEndpoints {
  readonly depthStream: string;
  readonly tradeStream: string;
  readonly userStream: string;
  readonly depthSnapshot: string;
  readonly orderRest: string;
}

export function binanceEndpoints(live: LiveConfig, symbol: string, listenKey: string): BinanceEndpoints {
  const s = symbol.toLowerCase();
  return {
    depthStream: `${live.wsEndpoint}/ws/${s}@depth@100ms`,
    tradeStream: `${live.wsEndpoint}/ws/${s}@trade`,
    userStream: `${live.wsEndpoint}/ws/${listenKey}`,
    depthSnapshot: `${live.restEndpoint}/api/v3/depth?symbol=${symbol.toUpperCase()}`,
    orderRest: `${live.restEndpoint}/api/v3/order`,
  };
}
