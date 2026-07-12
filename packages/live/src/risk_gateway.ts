import type { Clock, Gateway, RiskConfig } from '@hft/contracts';
import type { IdJournal } from './client_order_id';
import { GuardedGateway, type GuardedGatewayHooks } from './guarded_gateway';
import { KillSwitch, type KillSwitchLimits } from './kill_switch';
import { OrderRegistry } from './order_state';
import { TokenBucket } from './rate_limit';

export function riskLimits(risk: RiskConfig): KillSwitchLimits {
  return {
    maxPosition: risk.maxPosition,
    maxLossTicks: risk.maxLossTicks,
    maxOrdersPerSecond: risk.maxOrdersPerSecond,
    maxReconcileDrift: risk.reconcileToleranceQty,
  };
}

export interface RateLimitParams {
  readonly capacityTokens: number;
  readonly refillTokensPerSecond: number;
}

export interface RiskGatewayParams {
  readonly limits: KillSwitchLimits;
  readonly rateLimit: RateLimitParams;
}

export function buildGuardedGateway(
  inner: Gateway,
  clock: Clock,
  params: RiskGatewayParams,
  hooks: GuardedGatewayHooks,
  journal: IdJournal | null = null,
): GuardedGateway {
  const bucket = new TokenBucket(params.rateLimit.capacityTokens, params.rateLimit.refillTokensPerSecond, clock);
  const killSwitch = new KillSwitch(params.limits, clock, inner);
  return new GuardedGateway(inner, bucket, killSwitch, new OrderRegistry(), hooks, journal);
}
