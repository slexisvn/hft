import type { LinearModelArtifact } from '@hft/contracts';
import { formatRatioValue } from '../lib/format';
import { Panel } from './Panel';

export interface FeaturePanelProps {
  readonly model: LinearModelArtifact;
}

function weightScale(weights: readonly number[]): number {
  let max = 0;
  for (const weight of weights) max = Math.max(max, Math.abs(weight));
  return max === 0 ? 1 : max;
}

export function FeaturePanel({ model }: FeaturePanelProps): JSX.Element {
  const scale = weightScale(model.weights);
  const provenance = model.provenance;
  const caption =
    provenance === undefined
      ? `${model.inputs.length} inputs`
      : `OOS IC ${formatRatioValue(provenance.outOfSampleIc)} · IC t-stat ${provenance.icTStat.toFixed(2)}`;
  return (
    <Panel title="Feature weights" caption={caption}>
      <ul className="feature-list">
        {model.inputs.map((name, index) => {
          const weight = model.weights[index] ?? 0;
          const width = `${(Math.abs(weight) / scale) * 100}%`;
          return (
            <li key={name} className="feature-row" data-feature={name}>
              <span className="feature-name">{name}</span>
              <span className="feature-bar-track">
                <span
                  className={`feature-bar ${weight < 0 ? 'is-negative' : 'is-positive'}`}
                  style={{ width }}
                />
              </span>
              <span className="feature-weight">{weight.toExponential(3)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
