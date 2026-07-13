import type { TableSchema } from '@hft/contracts';
import type { LiveTelemetry } from '@hft/live/stats';
import type { TableRow } from './table';

export type { LiveTelemetry };

export interface StatsPayload {
  readonly telemetry: LiveTelemetry;
  readonly recentFills: readonly TableRow[];
  readonly fillsSchema: TableSchema;
  readonly strategy: string;
  readonly symbol: string;
}

export async function fetchStats(baseUrl: string, signal?: AbortSignal): Promise<StatsPayload> {
  const response = await fetch(`${baseUrl}/stats`, { signal });
  if (!response.ok) throw new Error(`stats request failed: ${response.status}`);
  return (await response.json()) as StatsPayload;
}
