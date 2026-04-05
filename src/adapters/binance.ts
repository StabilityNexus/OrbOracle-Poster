import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';
import { withRetry } from '../utils/retry';
import { CircuitBreaker } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

export class BinanceAdapter implements PriceAdapter {
  name = 'binance';
  
  private readonly circuitBreaker = new CircuitBreaker(
    { failureThreshold: 5, failureWindowMs: 60000, resetTimeoutMs: 30000, openResetTimeoutMs: 60000 },
    'binance'
  );
  
  // Binance symbol mapping format ETHUSDT
  private pairToSymbol: Record<string, string> = {
    'ETH/USDT': 'ETHUSDT',
    'BTC/USDT': 'BTCUSDT',
  };

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  async fetchPrice(pair: string): Promise<PriceResult> {
    return this.circuitBreaker.execute(async () =>
      withRetry(async () => this.doFetchPrice(pair), {
        maxAttempts: 3,
        operationName: `binance.fetchPrice.${pair}`,
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
        throw new Error(`BinanceAdapter: Unsupported pair ${pair}`);
    }

    try {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
      const response = await axios.get(url, { timeout: 5000 });
      
      const priceVal = response.data.price;
      const scaledPrice = normalizePriceTo18(priceVal);

      logger.debug({ event: 'PRICE_FETCHED', adapter: this.name, pair, price: priceVal });

      return {
        price: scaledPrice,
        timestamp: Date.now(),
        confidence: 0.99, // Binance generally has high confidence for liquidity
      };
    } catch (error: any) {
      logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: error.message });
      getMonitor()?.emitApiError({ source: this.name, error: error.message });
      throw error;
    }
  }
}
