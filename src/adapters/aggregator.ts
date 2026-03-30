import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';

export interface AggregatedPrice {
  price: bigint;
  sources: number;
  spreadBps: number;
  confidence: number;
  timestamp: number;
}

export class MedianAggregator {
  constructor(private adapters: PriceAdapter[]) {}

  async aggregate(pair: string): Promise<AggregatedPrice> {
    const results = await Promise.allSettled(this.adapters.map((a) => a.fetchPrice(pair)));
    const validPrices: PriceResult[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        validPrices.push(result.value);
      } else {
        logger.warn({ event: 'ADAPTER_FAILURE', pair, reason: result.reason?.message });
      }
    }

    const quorum = Math.ceil(this.adapters.length / 2);
    if (validPrices.length < quorum) {
      throw new Error(`Insufficient price sources - quorum not met. Expected at least ${quorum}, got ${validPrices.length}`);
    }

    validPrices.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

    const mid = Math.floor(validPrices.length / 2);
    const medianPrice =
      validPrices.length % 2 !== 0
        ? validPrices[mid].price
        : (validPrices[mid - 1].price + validPrices[mid].price) / 2n;

    if (medianPrice <= 0n) {
      throw new Error('Median price is non-positive');
    }

    const minPrice = validPrices[0].price;
    const maxPrice = validPrices[validPrices.length - 1].price;
    const spreadBps = Number(((maxPrice - minPrice) * 10000n) / medianPrice);
    const avgConfidence = validPrices.reduce((acc, curr) => acc + curr.confidence, 0) / validPrices.length;
    const latestTimestamp = Math.max(...validPrices.map((v) => v.timestamp));

    logger.info({
      event: 'PRICE_AGGREGATED',
      pair,
      price: medianPrice.toString(),
      spreadBps,
      sources: validPrices.length,
    });

    if (spreadBps > 50) {
      logger.warn({ event: 'HIGH_PRICE_SPREAD', pair, spreadBps });
    }

    return {
      price: medianPrice,
      sources: validPrices.length,
      spreadBps,
      confidence: avgConfidence,
      timestamp: latestTimestamp,
    };
  }
}
