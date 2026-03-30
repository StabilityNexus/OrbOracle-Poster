import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { normalizePriceTo18 } from './source/http';

export class BinanceAdapter implements PriceAdapter {
  name = 'binance';
  
  // Binance symbol mapping format ETHUSDT
  private pairToSymbol: Record<string, string> = {
    'ETH/USD': 'ETHUSDT',
    'BTC/USD': 'BTCUSDT',
  };

  async fetchPrice(pair: string): Promise<PriceResult> {
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
      throw error;
    }
  }
}
