import { ConfigError, type LinearModelArtifact, type Strategy, type StrategyParams } from '@hft/contracts';
import { AvellanedaStoikovStrategy } from './avellaneda_stoikov';
import { LinearSignalStrategy } from './linear_predictor';
import type { ClientOrderIdFactory } from './quoter';

export interface CreateStrategyOptions {
  readonly ofiWindowNs?: number;
  readonly idFactory?: ClientOrderIdFactory;
}

export function createStrategy(
  params: StrategyParams,
  model: LinearModelArtifact | null,
  options: CreateStrategyOptions = {},
): Strategy {
  const { ofiWindowNs, idFactory } = options;
  if (params.kind === 'avellaneda_stoikov') {
    return idFactory === undefined
      ? new AvellanedaStoikovStrategy(params)
      : new AvellanedaStoikovStrategy(params, idFactory);
  }
  if (model === null) throw new ConfigError('linear strategy requires a trained model artifact');
  if (ofiWindowNs === undefined) {
    throw new ConfigError('linear strategy requires metrics.ofiWindowNs to compute the ofi feature');
  }
  return idFactory === undefined
    ? new LinearSignalStrategy(params, model, ofiWindowNs)
    : new LinearSignalStrategy(params, model, ofiWindowNs, idFactory);
}
