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
  const records = parseCsvRecords(text);
  if (records.length === 0) return { header: [], rows: [] };
  return { header: records[0], rows: records.slice(1) };
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const endField = (): void => {
    record.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (ch === ',') {
      endField();
      sawAnyChar = true;
    } else if (ch === '\n') {
      if (sawAnyChar || field.length > 0 || record.length > 0) endRecord();
    } else if (ch === '\r') {
      // swallow; the following \n (or field/record end) closes the record
    } else {
      field += ch;
      sawAnyChar = true;
    }
  }
  if (sawAnyChar || field.length > 0 || record.length > 0) endRecord();
  return records;
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

export type OutputFormat = 'csv';

export type TableSerializer = (schema: TableSchema, rows: readonly (readonly (number | string)[])[]) => string;

const TABLE_SERIALIZERS: Record<OutputFormat, TableSerializer> = {
  csv: toCsv,
};

export function getTableSerializer(format: OutputFormat): TableSerializer {
  const serializer = TABLE_SERIALIZERS[format];
  if (serializer === undefined) throw new Error(`no table serializer registered for format "${format}"`);
  return serializer;
}
