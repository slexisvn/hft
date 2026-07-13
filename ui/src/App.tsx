import { useState } from 'react';
import { DataSourceBar } from './components/DataSourceBar';
import { LiveView } from './components/LiveView';
import { ReportView } from './components/ReportView';
import { useTheme } from './hooks/useTheme';
import type { ReportData } from './lib/loaders';

type Tab = 'report' | 'live';

const DEFAULT_BASE_URL = 'http://localhost:8787';
const LIVE_POLL_MS = 500;

export function App(): JSX.Element {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>('report');
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_BASE_URL);
  const [report, setReport] = useState<ReportData | null>(null);

  return (
    <div className="app">
      <header className="app-bar">
        <h1>hft observability</h1>
        <nav className="tabs">
          <button type="button" className={tab === 'report' ? 'is-active' : ''} onClick={() => setTab('report')}>
            Backtest report
          </button>
          <button type="button" className={tab === 'live' ? 'is-active' : ''} onClick={() => setTab('live')}>
            Live monitor
          </button>
        </nav>
        <div className="app-controls">
          <label className="base-url">
            server
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} />
          </label>
          <button type="button" className="theme-toggle" onClick={toggle}>
            {theme === 'dark' ? 'light' : 'dark'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {tab === 'report' ? (
          <>
            <DataSourceBar baseUrl={baseUrl} onLoad={setReport} />
            {report === null ? (
              <p className="notice">load a report from files or the stats server to begin.</p>
            ) : (
              <ReportView data={report} />
            )}
          </>
        ) : (
          <LiveView baseUrl={baseUrl} pollMs={LIVE_POLL_MS} />
        )}
      </main>
    </div>
  );
}
