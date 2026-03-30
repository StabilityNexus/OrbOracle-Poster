import { Submitter } from '../src/poster/submitter';

describe('Submitter.isRetryableError', () => {
  it('marks timeout as retryable', () => {
    expect(Submitter.isRetryableError(new Error('request timeout'))).toBe(true);
  });

  it('marks nonce-too-low as retryable', () => {
    expect(Submitter.isRetryableError(new Error('nonce too low'))).toBe(true);
  });

  it('marks revert as non-retryable', () => {
    expect(Submitter.isRetryableError(new Error('execution reverted'))).toBe(false);
  });
});
