export interface InventorySummary {
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly end: number;
}

export function inventorySummary(inventory: Int32Array): InventorySummary {
  const n = inventory.length;
  if (n === 0) return { mean: 0, min: 0, max: 0, end: 0 };
  let sum = 0;
  let min = inventory[0];
  let max = inventory[0];
  for (let i = 0; i < n; i++) {
    const v = inventory[i];
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { mean: sum / n, min, max, end: inventory[n - 1] };
}

export function timeWeightedInventory(timestampNs: Float64Array, inventory: Int32Array): number {
  const n = Math.min(timestampNs.length, inventory.length);
  if (n === 0) return 0;
  if (n === 1) return inventory[0];
  let weighted = 0;
  let span = 0;
  for (let i = 1; i < n; i++) {
    const dt = timestampNs[i] - timestampNs[i - 1];
    if (dt <= 0) continue;
    weighted += inventory[i - 1] * dt;
    span += dt;
  }
  return span === 0 ? inventory[n - 1] : weighted / span;
}

export function fillRatio(fillCount: number, submissionCount: number): number {
  if (submissionCount === 0) return 0;
  return fillCount / submissionCount;
}
