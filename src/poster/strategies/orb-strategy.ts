import { BasePosterStrategy, ProtocolState } from './base-strategy';

export class OrbPosterStrategy extends BasePosterStrategy {
  computeSubmissionValue(state: ProtocolState): bigint {
    return state.externalPrice; // Orb just passes the raw external price
  }
}
