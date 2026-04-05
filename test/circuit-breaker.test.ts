import { CircuitBreaker, CircuitState } from '../src/utils/circuit-breaker';
import fs from 'fs';
import path from 'path';

const TEST_STATE_FILE = path.resolve(process.cwd(), './data/circuit-breaker-state.json');

function clearCircuitState() {
  try {
    if (fs.existsSync(TEST_STATE_FILE)) {
      fs.unlinkSync(TEST_STATE_FILE);
    }
  } catch {}
}

describe('CircuitBreaker', () => {
  beforeEach(() => {
    clearCircuitState();
  });

  afterAll(() => {
    clearCircuitState();
  });

  describe('Initial state', () => {
    it('starts in NORMAL state', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 }, `normal-${Date.now()}`);
      expect(breaker.getState()).toBe(CircuitState.NORMAL);
    });

    it('allows execution in NORMAL state', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 }, `exec-${Date.now()}`);
      expect(breaker.canExecute()).toBe(true);
    });

    it('starts with zero failures', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 }, `fail-${Date.now()}`);
      expect(breaker.getFailureCount()).toBe(0);
    });
  });

  describe('State transitions via execute', () => {
    it('transitions to WARNING after threshold failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3, failureWindowMs: 60000 }, `warn-${Date.now()}`);
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      expect(breaker.getState()).toBe(CircuitState.WARNING);
    });

    it('transitions to OPEN after double threshold failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3, failureWindowMs: 60000 }, `open-${Date.now()}`);
      for (let i = 0; i < 6; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('blocks execution in OPEN state', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, failureWindowMs: 60000 }, `block-${Date.now()}`);
      for (let i = 0; i < 4; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      expect(breaker.canExecute()).toBe(false);
    });

    it('allows execution in WARNING state', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 3, failureWindowMs: 60000 }, `allow-${Date.now()}`);
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      expect(breaker.canExecute()).toBe(true);
    });
  });

  describe('Success handling', () => {
    it('resets failure count on success', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 10, failureWindowMs: 60000 }, `reset-${Date.now()}`);
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      await breaker.execute(async () => 'success');
      expect(breaker.getFailureCount()).toBe(0);
    });

    it('resets WARNING to NORMAL after success with timeout', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, failureWindowMs: 60000, resetTimeoutMs: 1 }, `norm-${Date.now()}`);
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}

      // Ensure the resetTimeoutMs window has elapsed.
      await new Promise((resolve) => setTimeout(resolve, 2));

      await breaker.execute(async () => 'success');
      expect(breaker.getState()).toBe(CircuitState.NORMAL);
    });
  });

  describe('Snapshot', () => {
    it('returns current state snapshot', () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 }, `snap-${Date.now()}`);
      const snapshot = breaker.getSnapshot();
      expect(snapshot).toHaveProperty('state');
      expect(snapshot).toHaveProperty('failureCount');
      expect(snapshot).toHaveProperty('lastFailureTime');
      expect(snapshot).toHaveProperty('lastStateChangeTime');
    });
  });

  describe('execute method', () => {
    it('executes operation when closed', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5 }, `ok-${Date.now()}`);
      const result = await breaker.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('throws when open', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 2, failureWindowMs: 60000 }, `throw-${Date.now()}`);
      for (let i = 0; i < 4; i++) {
        try { await breaker.execute(async () => { throw new Error('fail'); }); } catch {}
      }
      await expect(breaker.execute(async () => 'fail')).rejects.toThrow('Circuit breaker OPEN');
    });
  });
});