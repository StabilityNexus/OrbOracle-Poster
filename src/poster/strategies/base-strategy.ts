export interface ProtocolState {
  externalPrice: bigint;
  // Extensible for Karma (e.g., bullCoinPrice, bearCoinPrice, holderWeights)
  [key: string]: any;
}

export abstract class BasePosterStrategy {
  abstract computeSubmissionValue(state: ProtocolState): bigint;
}
