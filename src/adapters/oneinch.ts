import axios from 'axios';
import { PriceAdapter, PriceResult } from './types';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { CircuitBreaker, CircuitBreakerOptions } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

type SupportedPair = 'ETH/USD' | 'BTC/USD';

type TokenSpec = {
  address: `0x${string}`;
  decimals: number;
};

type PairSpec = {
  base: TokenSpec;
  quote: TokenSpec;
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = 'https://api.1inch.io/v5.0/1';

// Mainnet token addresses.
const TOKENS = {
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
} as const;

const PAIRS: Record<SupportedPair, PairSpec> = {
  'ETH/USD': { base: TOKENS.WETH, quote: TOKENS.USDC },
  'BTC/USD': { base: TOKENS.WBTC, quote: TOKENS.USDC },
};

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new Error(`Invalid pow10 exponent: ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

function scaleTo18(amount: bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }
  if (decimals === 18) return amount;
  if (decimals < 18) return amount * pow10(18 - decimals);
  return amount / pow10(decimals - 18);
}

export class OneInchAdapter implements PriceAdapter {
  name = 'oneinch';

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(options?: { baseUrl?: string; timeoutMs?: number; circuitBreaker?: Partial<CircuitBreakerOptions> }) {
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.circuitBreaker = new CircuitBreaker(
      {
        failureThreshold: 5,
        failureWindowMs: 60000,
        resetTimeoutMs: 30000,
        openResetTimeoutMs: 60000,
        ...(options?.circuitBreaker ?? {}),
      },
      this.name,
    );
  }

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  async fetchPrice(pair: string): Promise<PriceResult> {
    return this.circuitBreaker.execute(async () =>
      withRetry(async () => this.doFetchPrice(pair), {
        maxAttempts: 3,
        operationName: `oneinch.fetchPrice.${pair}`,
        isRetryable: (err) => {
          const msg = String(err).toLowerCase();
          return msg.includes('timeout') || msg.includes('429') || msg.includes('5') || msg.includes('network') || msg.includes('econn');
        },
      }),
    );
  }

  private async doFetchPrice(pair: string): Promise<PriceResult> {
    const spec = (PAIRS as Record<string, PairSpec | undefined>)[pair];
    if (!spec) {
      throw new Error(`OneInchAdapter: Unsupported pair ${pair}`);
    }

    const amount = pow10(spec.base.decimals);

    try {
      const response = await axios.get(`${this.baseUrl}/quote`, {
        timeout: this.timeoutMs,
        params: {
          fromTokenAddress: spec.base.address,
          toTokenAddress: spec.quote.address,
          amount: amount.toString(),
        },
      });

      const toTokenAmountRaw = response.data?.toTokenAmount;
      const toTokenDecimalsRaw = response.data?.toToken?.decimals;

      if (typeof toTokenAmountRaw !== 'string') {
        throw new Error('Invalid response structure - toTokenAmount not found');
      }

      const quoteDecimals = typeof toTokenDecimalsRaw === 'number' ? toTokenDecimalsRaw : spec.quote.decimals;

      const quoteAmount = BigInt(toTokenAmountRaw);
      if (quoteAmount <= 0n) {
        throw new Error('Invalid non-positive quote amount from source');
      }

      const price = scaleTo18(quoteAmount, quoteDecimals);

      logger.debug({
        event: 'PRICE_FETCHED',
        adapter: this.name,
        pair,
        price: price.toString(),
        quoteDecimals,
      });

      return { price, timestamp: Date.now(), confidence: 0.7 };
    } catch (error: any) {
      logger.error({ event: 'PRICE_FETCH_ERROR', adapter: this.name, pair, error: error.message });
      getMonitor()?.emitApiError({ source: this.name, error: error.message });
      throw error;
    }
  }
}
