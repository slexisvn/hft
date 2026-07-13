import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportView } from '../src/components/ReportView';
import { KPI_DEFS } from '../src/lib/kpi';
import { fixtureModel, fixtureReport } from './fixtures';

afterEach(cleanup);

describe('ReportView', () => {
  it('renders every KPI value from the metrics object', () => {
    render(<ReportView data={fixtureReport} />);
    for (const def of KPI_DEFS) {
      const expected = def.format(fixtureReport.metrics[def.key]);
      expect(screen.getByText(expected), `KPI ${def.key} should render ${expected}`).toBeInTheDocument();
    }
  });

  it('renders each model input feature name', () => {
    render(<ReportView data={fixtureReport} />);
    for (const name of fixtureModel.inputs) {
      expect(screen.getByText(name), `feature ${name} should render`).toBeInTheDocument();
    }
  });

  it('shows the gate verdict derived from provenance', () => {
    render(<ReportView data={fixtureReport} />);
    expect(screen.getByText(/PASS/)).toBeInTheDocument();
  });
});
