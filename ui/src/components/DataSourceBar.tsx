import { useCallback, useRef, useState } from 'react';
import { FILLS_SCHEMA } from '@hft/contracts';
import type { ReportData } from '../lib/loaders';
import { fetchReport, parseFills, parseMetrics, parseModel } from '../lib/loaders';

export interface DataSourceBarProps {
  readonly baseUrl: string;
  readonly onLoad: (data: ReportData) => void;
}

interface Classified {
  metricsText?: string;
  modelText?: string;
  fillsText?: string;
}

function classify(name: string, text: string, into: Classified): void {
  if (name.endsWith('.csv')) {
    into.fillsText = text;
    return;
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if ('weights' in parsed && 'inputs' in parsed) into.modelText = text;
  else into.metricsText = text;
}

async function assemble(files: FileList): Promise<ReportData> {
  const classified: Classified = {};
  for (const file of Array.from(files)) classify(file.name, await file.text(), classified);
  if (classified.metricsText === undefined) throw new Error('select a metrics.json file');
  return {
    metrics: parseMetrics(classified.metricsText),
    model: classified.modelText === undefined ? null : parseModel(classified.modelText),
    fills: classified.fillsText === undefined ? [] : parseFills(classified.fillsText),
    fillsSchema: FILLS_SCHEMA,
  };
}

export function DataSourceBar({ baseUrl, onLoad }: DataSourceBarProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const load = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (files === null || files.length === 0) return;
      try {
        onLoad(await assemble(files));
        setStatus(`loaded ${files.length} file(s)`);
      } catch (caught) {
        setStatus(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [onLoad],
  );

  const loadFromServer = useCallback(async (): Promise<void> => {
    try {
      onLoad(await fetchReport(baseUrl));
      setStatus(`loaded from ${baseUrl}`);
    } catch (caught) {
      setStatus(caught instanceof Error ? caught.message : String(caught));
    }
  }, [baseUrl, onLoad]);

  return (
    <div
      className={`source-bar ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void load(event.dataTransfer.files);
      }}
    >
      <span className="source-hint">drop metrics.json · model.json · fills.csv, or</span>
      <button type="button" onClick={() => inputRef.current?.click()}>
        choose files
      </button>
      <button type="button" onClick={() => void loadFromServer()}>
        fetch from server
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".json,.csv"
        hidden
        onChange={(event) => void load(event.target.files)}
      />
      {status !== null && <span className="source-status">{status}</span>}
    </div>
  );
}
