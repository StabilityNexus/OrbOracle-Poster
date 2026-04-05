import { logger } from './logger';

const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_JITTER_FACTOR = 0.25;
const DEFAULT_MAX_ATTEMPTS = 3;

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number;
  operationName?: string;
  isRetryable?: (error: unknown) => boolean;
}

export function withJitter(delayMs: number, jitterFactor: number = DEFAULT_JITTER_FACTOR): number {
  const jitter = delayMs * jitterFactor;
  const randomOffset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs + randomOffset));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    operationName = 'operation',
    isRetryable = () => true,
  } = options;

  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be at least 1');
  }

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error: any) {
      if (!isRetryable(error)) {
        throw error;
      }
      attempt++;
      if (attempt >= maxAttempts) {
        logger.error({ 
          event: 'RETRY_FAILED_FINALLY', 
          operationName, 
          attempts: attempt, 
          error: error.message 
        });
        throw error;
      }
      
      const jitteredDelay = withJitter(delay, jitterFactor);
      logger.warn({ 
        event: 'OPERATION_FAILED_RETRYING', 
        operationName, 
        attempt, 
        delayMs: jitteredDelay, 
        error: error.message 
      });
      
      await new Promise(res => setTimeout(res, jitteredDelay));
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw new Error('Unreachable');
}

export async function withRetryLegacy<T>(
  operation: () => Promise<T>,
  maxAttempts: number,
  backoffMultiplier: number,
  operationName: string,
  isRetryable?: (error: unknown) => boolean
): Promise<T> {
  return withRetry(operation, {
    maxAttempts,
    backoffMultiplier,
    operationName,
    isRetryable,
  });
}