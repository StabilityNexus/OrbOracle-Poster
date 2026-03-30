import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';

export class CoinmarketcapAdapter implements PriceAdapter {
  name = 'coinmarketcap';
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.CMC_API_KEY || '';
  }

  // Symbol mapping
  private pairToSymbol: Record<string, string> = {
    'ETH/USD': 'ETH',
    'BTC/USD': 'BTC',
  };

  async fetchPrice(pair: string): Promise<PriceResult> {
    const symbol = this.pairToSymbol[pair];
    if (!symbol) {
      throw new Error(`CoinmarketcapAdapter: Unsupported pair ${pair}`);
    }
    
    // In test env without API key, we simulate a fallback or fail fast
    if (!this.apiKey && process.env.NODE_ENV !== 'production') {
      logger.warn({ event: 'NO_API_KEY', adapter: this.name }, 'Missing CMC_API_KEY, relying on other adapters');
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
      throw error;
    }
  }
}
