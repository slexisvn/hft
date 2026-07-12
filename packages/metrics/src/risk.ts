export interface PnlRiskSummary {
  readonly sharpePerStep: number;
  readonly sortinoPerStep: number;
  readonly maxDrawdownTicks: number;
}

export function pnlRiskSummary(pnlTicks: Float64Array): PnlRiskSummary {
  const n = pnlTicks.length;
  if (n < 2) return { sharpePerStep: 0, sortinoPerStep: 0, maxDrawdownTicks: 0 };

  const steps = n - 1;
  let sum = 0;
  for (let i = 1; i < n; i++) sum += pnlTicks[i] - pnlTicks[i - 1];
  const mean = sum / steps;

  let varSum = 0;
  let downSum = 0;
  for (let i = 1; i < n; i++) {
    const r = pnlTicks[i] - pnlTicks[i - 1];
    const d = r - mean;
    varSum += d * d;
    if (r < 0) downSum += r * r;
  }
  const std = Math.sqrt(varSum / steps);
  const downStd = Math.sqrt(downSum / steps);

  let peak = pnlTicks[0];
  let maxDrawdown = 0;
  for (let i = 0; i < n; i++) {
    if (pnlTicks[i] > peak) peak = pnlTicks[i];
    const dd = peak - pnlTicks[i];
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  return {
    sharpePerStep: std === 0 ? 0 : mean / std,
    sortinoPerStep: downStd === 0 ? 0 : mean / downStd,
    maxDrawdownTicks: maxDrawdown,
  };
}
