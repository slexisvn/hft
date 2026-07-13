import { columnIndex, parseCsv, type ColumnType, type TableSchema } from '@hft/contracts';

export type TableRow = Readonly<Record<string, number | string>>;

function coerceCell(value: string, type: ColumnType): number | string {
  return type === 'str' ? value : Number(value);
}

export function parseTable(text: string, schema: TableSchema): TableRow[] {
  const parsed = parseCsv(text);
  if (parsed.rows.length === 0) return [];
  const columns = schema.columns.map((column) => ({
    name: column.name,
    type: column.type,
    at: columnIndex(parsed.header, column.name),
  }));
  return parsed.rows.map((source) => {
    const record: Record<string, number | string> = {};
    for (const column of columns) record[column.name] = coerceCell(source[column.at], column.type);
    return record;
  });
}

export function numberAt(row: TableRow, column: string): number {
  return Number(row[column]);
}
