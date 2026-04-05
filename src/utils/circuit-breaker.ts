import fs from 'fs';
import path from 'path';
import { logger } from './logger';

export enum CircuitState {
  NORMAL = 'NORMAL',
  WARNING = 'WARNING',
  OPEN = 'OPEN',
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  failureWindowMs: number;
  resetTimeoutMs: number;
  openResetTimeoutMs?: number;
  name?: string;
}

export interface CircuitBreakerSnapshot {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  lastStateChangeTime: number;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  failureWindowMs: 60000,
  resetTimeoutMs: 30000,
  openResetTimeoutMs: 60000,
  name: 'default',
};

export class CircuitBreaker {
  private state: CircuitState = CircuitState.NORMAL;
  private failureCount: number = 0;
  private failureTimestamps: number[] = [];
  private lastStateChangeTime: number = Date.now();
  private readonly options: CircuitBreakerOptions;
  private readonly name: string;
  private readonly persistPath: string;

  constructor(options: Partial<CircuitBreakerOptions> = {}, name: string = 'default') {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.name = name;
    this.persistPath = path.resolve(process.cwd(), `./data/circuit-breaker-state.json`);
    this.loadState();
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      const timeSinceStateChange = Date.now() - this.lastStateChangeTime;
      if (timeSinceStateChange >= (this.options.openResetTimeoutMs ?? 60000)) {
        this.transitionTo(CircuitState.WARNING);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}, failing fast`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error: any) {
      this.onFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  canExecute(): boolean {
    return this.state !== CircuitState.OPEN;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.failureTimestamps[this.failureTimestamps.length - 1] || 0,
      lastStateChangeTime: this.lastStateChangeTime,
    };
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.failureTimestamps = [];
    
    if (this.state === CircuitState.WARNING) {
      const timeSinceStateChange = Date.now() - this.lastStateChangeTime;
      if (timeSinceStateChange >= this.options.resetTimeoutMs) {
        this.transitionTo(CircuitState.NORMAL);
      }
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failureTimestamps.push(now);
    
    this.failureTimestamps = this.failureTimestamps.filter(
      t => now - t <= this.options.failureWindowMs
    );
    
    this.failureCount = this.failureTimestamps.length;
    
    if (this.state === CircuitState.NORMAL) {
      if (this.failureCount >= this.options.failureThreshold) {
        if (this.failureCount >= this.options.failureThreshold * 2) {
          this.transitionTo(CircuitState.OPEN);
        } else {
          this.transitionTo(CircuitState.WARNING);
        }
      }
    } else if (this.state === CircuitState.WARNING) {
      if (this.failureCount >= this.options.failureThreshold * 2) {
        this.transitionTo(CircuitState.OPEN);
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    
    logger.warn({
      event: newState === CircuitState.OPEN ? 'CIRCUIT_OPEN' 
        : newState === CircuitState.WARNING ? 'CIRCUIT_WARNING'
        : 'CIRCUIT_RESET',
      circuit: this.name,
      oldState,
      newState,
      failureCount: this.failureCount,
    });
    
    this.persistState();
  }

  private persistState(): void {
    try {
      const dir = path.dirname(this.persistPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      let state: Record<string, any> = {};
      if (fs.existsSync(this.persistPath)) {
        try {
          state = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
        } catch {
          state = {};
        }
      }
      
      state[this.name] = this.getSnapshot();
      fs.writeFileSync(this.persistPath, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error: any) {
      logger.error({
        event: 'CIRCUIT_PERSIST_ERROR',
        circuit: this.name,
        error: error.message,
      });
    }
  }

  private loadState(): void {
    try {
      if (!fs.existsSync(this.persistPath)) {
        return;
      }
      
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const state = JSON.parse(raw);
      
      if (state[this.name]) {
        const snapshot = state[this.name] as CircuitBreakerSnapshot;
        this.state = snapshot.state;
        this.failureCount = snapshot.failureCount;
        this.lastStateChangeTime = snapshot.lastStateChangeTime;
        
        logger.info({
          event: 'CIRCUIT_LOADED',
          circuit: this.name,
          state: this.state,
          failureCount: this.failureCount,
        });
      }
    } catch (error: any) {
      logger.warn({
        event: 'CIRCUIT_LOAD_ERROR',
        circuit: this.name,
        error: error.message,
      });
      this.state = CircuitState.NORMAL;
    }
  }
}