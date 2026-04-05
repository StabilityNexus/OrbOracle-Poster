import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';
import { withRetry } from '../utils/retry';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

export class CoinmarketcapAdapter implements PriceAdapter {
  name = 'coinmarketcap';
  private apiKey: string;

  private readonly circuitBreaker = new CircuitBreaker(
    { failureThreshold: 5, failureWindowMs: 60000, resetTimeoutMs: 30000, openResetTimeoutMs: 60000 },
    'coinmarketcap'
  );

  constructor() {
    this.apiKey = process.env.CMC_API_KEY || '';
  }

  // Symbol mapping
  private pairToSymbol: Record<string, string> = {
    'ETH/USD': 'ETH',
    'BTC/USD': 'BTC',
  };

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  async fetchPrice(pair: string): Promise<PriceResult> {
    return this.circuitBreaker.execute(async () =>
      withRetry(async () => this.doFetchPrice(pair), {
        maxAttempts: 3,
        operationName: `coinmarketcap.fetchPrice.${pair}`,
        isRetryable: (err) => {
          const msg = String(err).toLowerCase();
          return msg.includes('timeout') || msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('econn');
        },
      })
    );
  }

  private async doFetchPrice(pair: string): Promise<PriceResult> {
    const symbol = this.pairToSymbol[pair];
    if (!symbol) {
      throw new Error(`CoinmarketcapAdapter: Unsupported pair ${pair}`);
    }
    
    // In test env without API key, we simulate a fallback or fail fast
    if (!this.apiKey) {
      logger.warn({ event: 'NO_API_KEY', adapter: this.name }, 'Missing CMC_API_KEY, relying on other adapters');
      getMonitor()?.emitApiError({ source: this.name, error: 'Coinmarketcap API key missing' });
      throw new Error('Coinmarketcap API key missing');
    }

    try {
      const url = `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbol}`;
      const response = await axios.get(url, {
        headers: {
          'X-CMC_PRO_API_KEY': this.apiKey,
        },
        timeout: 5000,
      });

      const priceVal = response.data.data[symbol].quote.USD.price;
      const scaledPrice = normalizePriceTo18(priceVal);

      logger.debug({ event: 'PRICE_FETCHED', adapter: this.name, pair, price: priceVal });

      return {
        price: scaledPrice,
        timestamp: Date.now(),
        confidence: 0.95, // CMC higher confidence
      };
    } catch (error: any) {
      logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: error.message });
      getMonitor()?.emitApiError({ source: this.name, error: error.message });
      throw error;
    }
  }
}
