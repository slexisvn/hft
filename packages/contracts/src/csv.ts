import type { TableSchema } from './schema';

export function formatCell(value: number | string): string {
  if (typeof value === 'string') {
    if (value.indexOf(',') >= 0 || value.indexOf('"') >= 0 || value.indexOf('\n') >= 0) {
      return `"${value.split('"').join('""')}"`;
    }
    return value;
  }
  if (Number.isNaN(value)) return '';
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite value in csv cell: ${String(value)}`);
  }
  return String(value);
}

export function csvHeader(schema: TableSchema): string {
  const names: string[] = [];
  for (const c of schema.columns) names.push(c.name);
  return names.join(',');
}

export function csvRow(cells: readonly (number | string)[]): string {
  const out: string[] = [];
  for (const c of cells) out.push(formatCell(c));
  return out.join(',');
}

export interface ParsedCsv {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function parseCsv(text: string): ParsedCsv {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.charCodeAt(raw.length - 1) === 13 ? raw.slice(0, -1) : raw;
    if (line.length > 0) lines.push(line);
  }
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split(',');
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) rows.push(lines[i].split(','));
  return { header, rows };
}

export function columnIndex(header: readonly string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`csv column "${name}" not found in [${header.join(', ')}]`);
  return i;
}

export function toCsv(schema: TableSchema, rows: readonly (readonly (number | string)[])[]): string {
  const lines: string[] = [csvHeader(schema)];
  for (const r of rows) {
    if (r.length !== schema.columns.length) {
      throw new Error(`row width ${r.length} != schema width ${schema.columns.length}`);
    }
    lines.push(csvRow(r));
  }
  lines.push('');
  return lines.join('\n');
}
