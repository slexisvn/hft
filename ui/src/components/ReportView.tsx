import type { ReportData } from '../lib/loaders';
import { DrawdownChart } from './DrawdownChart';
import { EquityCurve } from './EquityCurve';
import { FeaturePanel } from './FeaturePanel';
import { KpiRow } from './KpiRow';
import { MarkoutChart } from './MarkoutChart';
import { ProvenanceHeader } from './ProvenanceHeader';

export interface ReportViewProps {
  readonly data: ReportData;
}

export function ReportView({ data }: ReportViewProps): JSX.Element {
  return (
    <div className="report">
      <ProvenanceHeader metrics={data.metrics} model={data.model} />
      <KpiRow metrics={data.metrics} />
      <EquityCurve fills={data.fills} />
      <div className="grid-two">
        <DrawdownChart fills={data.fills} />
        <MarkoutChart markout={data.metrics.markout} />
      </div>
      {data.model !== null && <FeaturePanel model={data.model} />}
    </div>
  );
}
