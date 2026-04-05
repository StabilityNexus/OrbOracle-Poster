import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';
import { withRetry } from '../utils/retry';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

export class CoinbaseAdapter implements PriceAdapter {
  name = 'coinbase';
  
  private readonly circuitBreaker = new CircuitBreaker(
    { failureThreshold: 5, failureWindowMs: 60000, resetTimeoutMs: 30000, openResetTimeoutMs: 60000 },
    'coinbase'
  );
  
  // Mapping standard pairs to Coinbase product IDs
  private pairToProductId: Record<string, string> = {
    'BTC/USD': 'BTC-USD',
    'ETH/USD': 'ETH-USD',
  };

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  async fetchPrice(pair: string): Promise<PriceResult> {
    return this.circuitBreaker.execute(async () => 
      withRetry(async () => this.doFetchPrice(pair), {
        maxAttempts: 3,
        operationName: `coinbase.fetchPrice.${pair}`,
        isRetryable: (err) => {
          const msg = String(err).toLowerCase();
          return msg.includes('timeout') || msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('econn');
        },
      })
    );
  }

  private async doFetchPrice(pair: string): Promise<PriceResult> {
    const productId = this.pairToProductId[pair];
    if (!productId) {
      throw new Error(`CoinbaseAdapter: Unsupported pair ${pair}`);
    }

    try {
      const response = await axios.get(
        `https://api.exchange.coinbase.com/products/${productId}/ticker`,
        { timeout: 5000 }
      );
      
      const priceVal = response.data?.price;
      if (priceVal === undefined || priceVal === null) {
        throw new Error('Invalid response structure');
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
