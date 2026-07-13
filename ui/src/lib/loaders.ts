import { FILLS_SCHEMA, type LinearModelArtifact, type MetricsJson, type TableSchema } from '@hft/contracts';
import { parseTable, type TableRow } from './table';

export interface ReportData {
  readonly metrics: MetricsJson;
  readonly model: LinearModelArtifact | null;
  readonly fills: readonly TableRow[];
  readonly fillsSchema: TableSchema;
}

interface ReportPayload {
  readonly metrics: MetricsJson | null;
  readonly model: LinearModelArtifact | null;
  readonly fills: readonly TableRow[];
  readonly fillsSchema: TableSchema;
}

export function parseMetrics(text: string): MetricsJson {
  return JSON.parse(text) as MetricsJson;
}

export function parseModel(text: string): LinearModelArtifact {
  return JSON.parse(text) as LinearModelArtifact;
}

export function parseFills(text: string): TableRow[] {
  return parseTable(text, FILLS_SCHEMA);
}

export async function fetchReport(baseUrl: string, signal?: AbortSignal): Promise<ReportData> {
  const response = await fetch(`${baseUrl}/report`, { signal });
  if (!response.ok) throw new Error(`report request failed: ${response.status}`);
  const payload = (await response.json()) as ReportPayload;
  if (payload.metrics === null) throw new Error('server has no metrics.json; run backtest first');
  return {
    metrics: payload.metrics,
    model: payload.model,
    fills: payload.fills,
    fillsSchema: payload.fillsSchema,
  };
}
