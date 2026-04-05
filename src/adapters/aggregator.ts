import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { getMonitor } from '../monitor/ws-server';

export interface AggregatedPrice {
  price: bigint;
  sources: number;
  spreadBps: number;
  confidence: number;
  timestamp: number;
}

export interface AggregatedSourceBreakdown {
  name: string;
  price: bigint;
  timestamp: number;
  age: number;
}

export interface AggregatedPriceDetailed {
  token: string;
  pair: string;
  price: bigint;
  median: bigint;
  sources: AggregatedSourceBreakdown[];
  timestamp: number;
  spreadBps: number;
  confidence: number;
}

export class UnsupportedTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedTokenError';
  }
}

export class MedianAggregator {
  constructor(private adapters: PriceAdapter[]) {}

  async aggregate(pair: string): Promise<AggregatedPrice> {
    const detailed = await this.aggregateDetailed(pair);
    return {
      price: detailed.price,
      sources: detailed.sources.length,
      spreadBps: detailed.spreadBps,
      confidence: detailed.confidence,
      timestamp: detailed.timestamp,
    };
  }

  async getPrice(token: string): Promise<AggregatedPriceDetailed> {
    const normalizedToken = token.trim().toUpperCase();
    if (!normalizedToken) {
      throw new UnsupportedTokenError('Token is required');
    }
    const pair = normalizedToken.includes('/') ? normalizedToken : `${normalizedToken}/USD`;
    return this.aggregateDetailed(pair);
  }

  async aggregateDetailed(pair: string): Promise<AggregatedPriceDetailed> {
    if (this.adapters.length === 0) {
      throw new Error('No adapters configured');
    }

    const startedAt = Date.now();
    const results = await Promise.allSettled(this.adapters.map((a) => a.fetchPrice(pair)));

    const sources: AggregatedSourceBreakdown[] = [];
    const validPrices: PriceResult[] = [];
    let unsupportedCount = 0;

    for (let i = 0; i < results.length; i++) {
      const adapter = this.adapters[i];
      const result = results[i];
      if (result.status === 'fulfilled') {
        const value = result.value;
        validPrices.push(value);
        sources.push({
          name: adapter.name,
          price: value.price,
          timestamp: value.timestamp,
          age: Math.max(0, startedAt - value.timestamp),
        });
      } else {
        const reasonMsg = result.reason?.message;
        if (typeof reasonMsg === 'string' && reasonMsg.toLowerCase().includes('unsupported pair')) {
          unsupportedCount++;
        }
        logger.warn({ event: 'ADAPTER_FAILURE', adapter: adapter.name, pair, reason: reasonMsg });
      }
    }

    if (unsupportedCount === this.adapters.length) {
      throw new UnsupportedTokenError(`Unsupported token/pair ${pair}`);
    }

    const quorum = Math.ceil(this.adapters.length / 2);
    if (validPrices.length < quorum) {
      throw new Error(
        `Insufficient price sources - quorum not met. Expected at least ${quorum}, got ${validPrices.length}`,
      );
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
    const conservativeTimestamp = Math.min(...validPrices.map((v) => v.timestamp));

    const token = pair.split('/')[0]?.trim().toUpperCase() || pair;

    logger.info({
      event: 'PRICE_AGGREGATED',
      pair,
      token,
      price: medianPrice.toString(),
      spreadBps,
      sources: validPrices.length,
    });

    if (spreadBps > 50) {
      logger.warn({ event: 'HIGH_PRICE_SPREAD', pair, spreadBps });
    }

    getMonitor()?.emitPriceUpdate({
      token,
      price: medianPrice.toString(),
      sources: sources.map((s) => ({
        name: s.name,
        price: s.price.toString(),
        age: s.age,
      })),
    });

    return {
      token,
      pair,
      price: medianPrice,
      median: medianPrice,
      sources,
      timestamp: conservativeTimestamp,
      spreadBps,
      confidence: avgConfidence,
    };
  }
}
