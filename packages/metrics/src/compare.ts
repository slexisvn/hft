export interface CompareFill {
  readonly clientOrderId: string;
  readonly size: number;
  readonly priceTicks: number;
  readonly queuePositionAtFill: number;
}

interface OrderAgg {
  filledSize: number;
  notional: number;
  firstQueuePosition: number;
}

export interface CompareReport {
  readonly simFillCount: number;
  readonly liveFillCount: number;
  readonly matchedOrders: number;
  readonly simOnlyOrders: number;
  readonly liveOnlyOrders: number;
  readonly simFilledSize: number;
  readonly liveFilledSize: number;
  readonly meanAbsQueueDelta: number;
  readonly meanAbsVwapDeltaTicks: number;
}

function aggregate(fills: readonly CompareFill[]): Map<string, OrderAgg> {
  const byId = new Map<string, OrderAgg>();
  for (const f of fills) {
    const prev = byId.get(f.clientOrderId);
    if (prev === undefined) {
      byId.set(f.clientOrderId, {
        filledSize: f.size,
        notional: f.priceTicks * f.size,
        firstQueuePosition: f.queuePositionAtFill,
      });
    } else {
      prev.filledSize += f.size;
      prev.notional += f.priceTicks * f.size;
    }
  }
  return byId;
}

export function compareFills(sim: readonly CompareFill[], live: readonly CompareFill[]): CompareReport {
  const simById = aggregate(sim);
  const liveById = aggregate(live);

  let matched = 0;
  let simOnly = 0;
  let queueDeltaSum = 0;
  let vwapDeltaSum = 0;
  let simFilledSize = 0;
  let liveFilledSize = 0;

  for (const [id, s] of simById) {
    simFilledSize += s.filledSize;
    const l = liveById.get(id);
    if (l === undefined) {
      simOnly++;
      continue;
    }
    matched++;
    queueDeltaSum += Math.abs(s.firstQueuePosition - l.firstQueuePosition);
    const simVwap = s.notional / s.filledSize;
    const liveVwap = l.notional / l.filledSize;
    vwapDeltaSum += Math.abs(simVwap - liveVwap);
  }

  let liveOnly = 0;
  for (const [id, l] of liveById) {
    liveFilledSize += l.filledSize;
    if (!simById.has(id)) liveOnly++;
  }

  return {
    simFillCount: sim.length,
    liveFillCount: live.length,
    matchedOrders: matched,
    simOnlyOrders: simOnly,
    liveOnlyOrders: liveOnly,
    simFilledSize,
    liveFilledSize,
    meanAbsQueueDelta: matched === 0 ? 0 : queueDeltaSum / matched,
    meanAbsVwapDeltaTicks: matched === 0 ? 0 : vwapDeltaSum / matched,
  };
}
