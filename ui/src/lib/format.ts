const NS_PER_US = 1_000;
const NS_PER_MS = 1_000_000;
const NS_PER_SECOND = 1_000_000_000;

export function formatTicks(value: number): string {
  return value.toFixed(2);
}

export function formatSignedTicks(value: number): string {
  const text = value.toFixed(2);
  return value > 0 ? `+${text}` : text;
}

export function formatRatioValue(value: number): string {
  return value.toFixed(4);
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export function formatInteger(value: number): string {
  return Math.round(value).toString();
}

export function formatHorizon(horizonNs: number): string {
  if (horizonNs >= NS_PER_SECOND) return `${horizonNs / NS_PER_SECOND}s`;
  if (horizonNs >= NS_PER_MS) return `${horizonNs / NS_PER_MS}ms`;
  if (horizonNs >= NS_PER_US) return `${horizonNs / NS_PER_US}µs`;
  return `${horizonNs}ns`;
}

export function formatClockNs(capturedAtNs: number): string {
  return new Date(capturedAtNs / NS_PER_MS).toLocaleTimeString();
}
