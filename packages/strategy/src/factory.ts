import { ConfigError, type LinearModelArtifact, type Strategy, type StrategyParams } from '@hft/contracts';
import { AvellanedaStoikovStrategy } from './avellaneda_stoikov';
import { LinearSignalStrategy } from './linear_predictor';
import type { ClientOrderIdFactory } from './quoter';

export function createStrategy(
  params: StrategyParams,
  model: LinearModelArtifact | null,
  idFactory?: ClientOrderIdFactory,
): Strategy {
  if (params.kind === 'avellaneda_stoikov') {
    return idFactory === undefined
      ? new AvellanedaStoikovStrategy(params)
      : new AvellanedaStoikovStrategy(params, idFactory);
  }
  if (model === null) throw new ConfigError('linear strategy requires a trained model artifact');
  return idFactory === undefined
    ? new LinearSignalStrategy(params, model)
    : new LinearSignalStrategy(params, model, idFactory);
}
