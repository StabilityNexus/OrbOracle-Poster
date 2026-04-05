import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';
import { withRetry } from '../utils/retry';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

export class KrakenAdapter implements PriceAdapter {
  name = 'kraken';
  
  private readonly circuitBreaker = new CircuitBreaker(
    { failureThreshold: 5, failureWindowMs: 60000, resetTimeoutMs: 30000, openResetTimeoutMs: 60000 },
    'kraken'
  );
  
  // Mapping standard pairs to Kraken's non-standard pair codes
  private pairToKrakenPair: Record<string, string> = {
    'BTC/USD': 'XXBTZUSD',
    'ETH/USD': 'XETHZUSD',
  };

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  async fetchPrice(pair: string): Promise<PriceResult> {
    return this.circuitBreaker.execute(async () => 
      withRetry(async () => this.doFetchPrice(pair), {
        maxAttempts: 3,
        operationName: `kraken.fetchPrice.${pair}`,
        isRetryable: (err) => {
          const msg = String(err).toLowerCase();
          return msg.includes('timeout') || msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('econn');
        },
      })
    );
  }

  private async doFetchPrice(pair: string): Promise<PriceResult> {
    const krakenPair = this.pairToKrakenPair[pair];
    if (!krakenPair) {
      throw new Error(`KrakenAdapter: Unsupported pair ${pair}`);
    }

    try {
      const response = await axios.get(
        `https://api.kraken.com/0/public/Ticker?pair=${krakenPair}`,
        { timeout: 5000 }
      );
      
      // Kraken response is nested: result[krakenPair].c[0] = last trade price (close)
      const result = response.data?.result;
      if (!result || !result[krakenPair]) {
        throw new Error('Invalid response structure');
      }
      
      const priceVal = result[krakenPair].c?.[0];
      if (priceVal === undefined || priceVal === null) {
        throw new Error('Invalid response structure - price not found');
      }

      const scaledPrice = normalizePriceTo18(priceVal);
      logger.debug({ event: 'PRICE_FETCHED', adapter: this.name, pair, price: priceVal });
      return { price: scaledPrice, timestamp: Date.now(), confidence: 0.9 };
    } catch (error: any) {
      logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: error.message });
      getMonitor()?.emitApiError({ source: this.name, error: error.message });
      throw error;
    }
  }
}
