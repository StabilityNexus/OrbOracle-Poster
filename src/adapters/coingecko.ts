import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';

export class CoingeckoAdapter implements PriceAdapter {
  name = 'coingecko';
  
  // Mapping standard pairs like "ETH/USD" to CoinGecko ids
  private pairToIds: Record<string, { id: string, vs: string }> = {
    'ETH/USD': { id: 'ethereum', vs: 'usd' },
    'BTC/USD': { id: 'bitcoin', vs: 'usd' },
  };

  async fetchPrice(pair: string): Promise<PriceResult> {
    const mapping = this.pairToIds[pair];
    if (!mapping) {
      throw new Error(`CoingeckoAdapter: Unsupported pair ${pair}`);
    }

    const apiKey = (process.env.COINGECKO_API_KEY || '').trim();
    const makeUrl = (base: string) => `${base}/simple/price?ids=${mapping.id}&vs_currencies=${mapping.vs}`;

    try {
      if (apiKey) {
        const proUrl = makeUrl('https://pro-api.coingecko.com/api/v3');
        const response = await axios.get(proUrl, {
          timeout: 5000,
          headers: { 'x-cg-pro-api-key': apiKey },
        });
        const priceVal = response.data[mapping.id][mapping.vs];
        if (priceVal === undefined || priceVal === null) {
          throw new Error('Invalid response structure');
        }
        const scaledPrice = normalizePriceTo18(priceVal);
        logger.debug({ event: 'PRICE_FETCHED', adapter: this.name, pair, price: priceVal });
        return { price: scaledPrice, timestamp: Date.now(), confidence: 0.9 };
      }

      const publicUrl = makeUrl('https://api.coingecko.com/api/v3');
      const response = await axios.get(publicUrl, { timeout: 5000 });
      
      const priceVal = response.data[mapping.id][mapping.vs];
      if (priceVal === undefined || priceVal === null) {
        throw new Error('Invalid response structure');
      }

      const scaledPrice = normalizePriceTo18(priceVal);
      logger.debug({ event: 'PRICE_FETCHED', adapter: this.name, pair, price: priceVal });
      return { price: scaledPrice, timestamp: Date.now(), confidence: 0.9 };
    } catch (error: any) {
      // If pro endpoint fails (e.g., 400 for invalid key), fall back to public once.
      const status = error?.response?.status;
      if (apiKey && status === 400) {
        try {
          const publicUrl = makeUrl('https://api.coingecko.com/api/v3');
          const response = await axios.get(publicUrl, { timeout: 5000 });
          const priceVal = response.data[mapping.id][mapping.vs];
          if (priceVal === undefined || priceVal === null) {
            throw new Error('Invalid response structure');
          }
          const scaledPrice = normalizePriceTo18(priceVal);
          logger.warn({ event: 'COINGECKO_FALLBACK', adapter: this.name, pair, status });
          return { price: scaledPrice, timestamp: Date.now(), confidence: 0.9 };
        } catch (fallbackError: any) {
          logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: fallbackError.message });
          throw fallbackError;
        }
      }

      logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: error.message });
      throw error;
    }
  }
}
