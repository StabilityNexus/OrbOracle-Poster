import { logger } from './logger';

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  backoffMultiplier: number,
  operationName: string
): Promise<T> {
  let attempt = 0;
  let delay = 1000; // start with 1s

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      if (attempt >= maxRetries) {
        logger.error({ 
          event: 'RETRY_FAILED_FINALLY', 
          operationName, 
          attempts: attempt, 
          error: error.message 
        });
        throw error;
      }
      
      logger.warn({ 
        event: 'OPERATION_FAILED_RETRYING', 
        operationName, 
        attempt, 
        delayMs: delay, 
        error: error.message 
      });
      
      await new Promise(res => setTimeout(res, delay));
      delay *= backoffMultiplier;
    }
  }

  throw new Error('Unreachable');
}
