import { PostingPolicy } from '../config/schema';

export interface PolicyState {
  lastSubmittedPrice: bigint | null;
  lastSubmitTime: number;
}

export type DecisionReason =
  | 'first_run'
  | 'heartbeat_expired'
  | 'deviation_threshold_crossed'
  | 'heartbeat_not_due'
  | 'deviation_below_threshold'
  | 'source_invalid'
  | 'source_stale'
  | 'duplicate_value_guard'
  | 'gas_above_ceiling'
  | 'dry_run_only'
  | 'insufficient_stake';

export interface PolicyContext {
  nowMs: number;
  sourceTimestampMs: number;
  dryRun: boolean;
  gasPriceGwei?: number;
}

export interface PolicyDecision {
  shouldSubmit: boolean;
  reason: DecisionReason;
  trigger: 'first_run' | 'heartbeat' | 'deviation' | null;
  deviationBps: number;
  trace: {
    nowMs: number;
    sourceTimestampMs: number;
    lastSubmitTime: number;
    currentPrice: string;
    lastSubmittedPrice: string | null;
  };
}

export class PolicyEngine {
  constructor(private policy: PostingPolicy) {}

  evaluate(currentPrice: bigint, state: PolicyState, ctx: PolicyContext): PolicyDecision {
    const trace = {
      nowMs: ctx.nowMs,
      sourceTimestampMs: ctx.sourceTimestampMs,
      lastSubmitTime: state.lastSubmitTime,
      currentPrice: currentPrice.toString(),
      lastSubmittedPrice: state.lastSubmittedPrice === null ? null : state.lastSubmittedPrice.toString(),
    };

    if (currentPrice <= 0n) {
      return { shouldSubmit: false, reason: 'source_invalid', trigger: null, deviationBps: 0, trace };
    }

    const stalenessMs = ctx.nowMs - ctx.sourceTimestampMs;
    if (stalenessMs > this.policy.staleAfterMs) {
      return { shouldSubmit: false, reason: 'source_stale', trigger: null, deviationBps: 0, trace };
    }

    let shouldSubmit = false;
    let reason: DecisionReason = 'heartbeat_not_due';
    let trigger: 'first_run' | 'heartbeat' | 'deviation' | null = null;
    let deviationBps = 0;

    if (state.lastSubmittedPrice === null || state.lastSubmitTime === 0) {
      shouldSubmit = true;
      reason = 'first_run';
      trigger = 'first_run';
    } else {
      const heartbeatElapsed = ctx.nowMs - state.lastSubmitTime >= this.policy.heartbeatIntervalMs;
      if (heartbeatElapsed) {
        shouldSubmit = true;
        reason = 'heartbeat_expired';
        trigger = 'heartbeat';
      } else if (currentPrice === state.lastSubmittedPrice) {
        shouldSubmit = false;
        reason = 'duplicate_value_guard';
      } else {
        const diff =
          currentPrice > state.lastSubmittedPrice
            ? currentPrice - state.lastSubmittedPrice
            : state.lastSubmittedPrice - currentPrice;
        deviationBps = Number((diff * 10000n) / state.lastSubmittedPrice);

        if (deviationBps >= this.policy.deviationThresholdBps) {
          shouldSubmit = true;
          reason = 'deviation_threshold_crossed';
          trigger = 'deviation';
        } else {
          shouldSubmit = false;
          reason = 'deviation_below_threshold';
        }
      }
    }

    if (
      shouldSubmit &&
      trigger !== 'heartbeat' &&
      this.policy.gasCeilingGwei !== undefined &&
      ctx.gasPriceGwei !== undefined &&
      ctx.gasPriceGwei > this.policy.gasCeilingGwei
    ) {
      return { shouldSubmit: false, reason: 'gas_above_ceiling', trigger: null, deviationBps, trace };
    }

    if (shouldSubmit && ctx.dryRun) {
      return { shouldSubmit: false, reason: 'dry_run_only', trigger, deviationBps, trace };
    }

    return { shouldSubmit, reason, trigger, deviationBps, trace };
  }
}
