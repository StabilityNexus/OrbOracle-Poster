import { PolicyEngine } from '../src/poster/policy';
import { PostingPolicy } from '../src/config/schema';

const basePolicy: PostingPolicy = {
  heartbeatIntervalMs: 60000,
  deviationThresholdBps: 50,
  maxRetries: 3,
  backoffMultiplier: 2,
  staleAfterMs: 120000,
};

describe('PolicyEngine', () => {
  const nowMs = 1_000_000;

  it('submits on first run', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      100n,
      { lastSubmittedPrice: null, lastSubmitTime: 0 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(true);
    expect(result.reason).toBe('first_run');
  });

  it('submits when heartbeat is due', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      100n,
      { lastSubmittedPrice: 100n, lastSubmitTime: nowMs - 60001 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(true);
    expect(result.reason).toBe('heartbeat_expired');
  });

  it('skips when heartbeat not due and deviation below threshold', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      1004n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toBe('deviation_below_threshold');
  });

  it('submits when deviation crosses threshold', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      1100n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(true);
    expect(result.reason).toBe('deviation_threshold_crossed');
    expect(result.trigger).toBe('deviation');
  });

  it('skips duplicate values', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      1000n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toBe('duplicate_value_guard');
  });

  it('rejects stale source data', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      1000n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs - 130000, dryRun: false },
    );

    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toBe('source_stale');
  });

  it('skips by gas ceiling for non-heartbeat triggers', () => {
    const engine = new PolicyEngine({ ...basePolicy, gasCeilingGwei: 25 });
    const result = engine.evaluate(
      1100n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: false, gasPriceGwei: 40 },
    );

    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toBe('gas_above_ceiling');
  });

  it('returns dry-run skip reason even when trigger would submit', () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.evaluate(
      1100n,
      { lastSubmittedPrice: 1000n, lastSubmitTime: nowMs - 1000 },
      { nowMs, sourceTimestampMs: nowMs, dryRun: true },
    );

    expect(result.shouldSubmit).toBe(false);
    expect(result.reason).toBe('dry_run_only');
  });
});
