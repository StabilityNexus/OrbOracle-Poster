export interface PriceResult {
  price: bigint;
  timestamp: number;
  confidence: number;
}

import type { CircuitState } from '../utils/circuit-breaker';

export interface PriceAdapter {
  name: string;
  fetchPrice(pair: string): Promise<PriceResult>;
  getCircuitBreakerState(): CircuitState;
}
