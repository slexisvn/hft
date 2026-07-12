import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { IdJournal } from '@hft/live';

export class FileIdJournal implements IdJournal {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, '', 'utf8');
  }

  append(clientOrderId: string): void {
    appendFileSync(this.path, `${clientOrderId}\n`, 'utf8');
  }

  load(): string[] {
    const out: string[] = [];
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      const id = line.trim();
      if (id.length > 0) out.push(id);
    }
    return out;
  }
}
