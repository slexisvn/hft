import type { LinearModelArtifact, MetricsJson } from '@hft/contracts';
import { evaluateGate, GATE_MIN_IC_T_STAT } from '../lib/gate';

export interface ProvenanceHeaderProps {
  readonly metrics: MetricsJson;
  readonly model: LinearModelArtifact | null;
}

interface Badge {
  readonly label: string;
  readonly value: string;
  readonly tone: 'neutral' | 'pass' | 'fail';
}

function buildBadges(metrics: MetricsJson, model: LinearModelArtifact | null): Badge[] {
  const badges: Badge[] = [
    { label: 'strategy', value: metrics.strategy, tone: 'neutral' },
    { label: 'metrics schema', value: `v${metrics.schemaVersion}`, tone: 'neutral' },
  ];
  if (model === null) {
    badges.push({ label: 'model', value: 'not loaded', tone: 'neutral' });
    return badges;
  }
  badges.push({ label: 'model schema', value: `v${model.schemaVersion}`, tone: 'neutral' });
  const provenance = model.provenance;
  if (provenance === undefined) {
    badges.push({ label: 'gate', value: 'no provenance', tone: 'neutral' });
    return badges;
  }
  const gate = evaluateGate(provenance);
  badges.push({
    label: `gate (t≥${GATE_MIN_IC_T_STAT})`,
    value: `${gate.passed ? 'PASS' : 'FAIL'} · t=${gate.deflatedIcTStat.toFixed(2)}`,
    tone: gate.passed ? 'pass' : 'fail',
  });
  badges.push({ label: 'dataset', value: provenance.datasetHash, tone: 'neutral' });
  badges.push({ label: 'config', value: provenance.configHash, tone: 'neutral' });
  badges.push({ label: 'generated', value: provenance.generatedAt, tone: 'neutral' });
  return badges;
}

export function ProvenanceHeader({ metrics, model }: ProvenanceHeaderProps): JSX.Element {
  return (
    <div className="badge-row">
      {buildBadges(metrics, model).map((badge) => (
        <span key={badge.label} className={`badge tone-${badge.tone}`}>
          <span className="badge-label">{badge.label}</span>
          <span className="badge-value">{badge.value}</span>
        </span>
      ))}
    </div>
  );
}
