import { Rng } from '@hft/numeric';

export type LatencySampler = () => number;

export function constantLatency(ns: number): LatencySampler {
  return () => ns;
}

export function lognormalLatency(medianNs: number, sigma: number, rng: Rng): LatencySampler {
  if (sigma <= 0) return constantLatency(medianNs);
  return () => Math.max(0, Math.round(medianNs * Math.exp(sigma * rng.nextNormal())));
}

export function empiricalLatency(samplesNs: readonly number[], rng: Rng): LatencySampler {
  const n = samplesNs.length;
  if (n === 0) throw new Error('empirical latency model needs at least one sample');
  return () => samplesNs[Math.min(n - 1, Math.floor(rng.nextUnit() * n))];
}
