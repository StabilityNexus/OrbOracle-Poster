import { withRetry, withJitter, RetryOptions } from '../src/utils/retry';

describe('withRetry', () => {
  it('succeeds on first attempt', async () => {
    const operation = jest.fn().mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxAttempts: 3, operationName: 'test-op' });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    
    const result = await withRetry(operation, { maxAttempts: 3, operationName: 'test-op' });
    
    expect(result).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('fails after max attempts', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('persistent failure'));
    
    await expect(
      withRetry(operation, { maxAttempts: 3, operationName: 'test-op' })
    ).rejects.toThrow('persistent failure');
    
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('respects isRetryable function', async () => {
    const nonRetryableError = new Error('non-retryable');
    const operation = jest.fn()
      .mockRejectedValueOnce(nonRetryableError)
      .mockResolvedValue('success');
    
    const isRetryable = (error: unknown) => error instanceof Error && error.message !== 'non-retryable';
    
    await expect(
      withRetry(operation, { maxAttempts: 3, operationName: 'test-op', isRetryable })
    ).rejects.toThrow('non-retryable');
    
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('validates maxAttempts >= 1', async () => {
    const operation = jest.fn();
    
    await expect(
      withRetry(operation, { maxAttempts: 0, operationName: 'test-op' })
    ).rejects.toThrow('maxAttempts must be at least 1');
  });
});

describe('withJitter', () => {
  it('adds randomness to delay', () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i++) {
      results.add(withJitter(1000, 0.25));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('returns value within jitter range', () => {
    for (let i = 0; i < 100; i++) {
      const result = withJitter(1000, 0.25);
      expect(result).toBeGreaterThanOrEqual(750);
      expect(result).toBeLessThanOrEqual(1250);
    }
  });
});