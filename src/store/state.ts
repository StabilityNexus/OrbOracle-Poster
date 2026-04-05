import fs from 'fs';
import path from 'path';

export interface OracleRuntimeState {
  lastFetchedPrice: bigint | null;
  lastSubmittedPrice: bigint | null;
  lastFetchTime: number;
  lastSubmitTime: number;
  lastSuccessTime: number;
  lastSourceTimestamp: number;
  lastTxHash: string | null;
  recentFailures: string[];
  lastDecisionReason: string | null;
}

interface SerializedOracleRuntimeState {
  lastFetchedPrice: string | null;
  lastSubmittedPrice: string | null;
  lastFetchTime: number;
  lastSubmitTime: number;
  lastSuccessTime: number;
  lastSourceTimestamp: number;
  lastTxHash: string | null;
  recentFailures: string[];
  lastDecisionReason: string | null;
}

type SerializedState = Record<string, SerializedOracleRuntimeState>;

export function defaultOracleState(): OracleRuntimeState {
  return {
    lastFetchedPrice: null,
    lastSubmittedPrice: null,
    lastFetchTime: 0,
    lastSubmitTime: 0,
    lastSuccessTime: 0,
    lastSourceTimestamp: 0,
    lastTxHash: null,
    recentFailures: [],
    lastDecisionReason: null,
  };
}

function serializeState(state: OracleRuntimeState): SerializedOracleRuntimeState {
  return {
    ...state,
    lastFetchedPrice: state.lastFetchedPrice === null ? null : state.lastFetchedPrice.toString(),
    lastSubmittedPrice: state.lastSubmittedPrice === null ? null : state.lastSubmittedPrice.toString(),
  };
}

function deserializeState(state: SerializedOracleRuntimeState): OracleRuntimeState {
  return {
    ...state,
    lastFetchedPrice: state.lastFetchedPrice === null ? null : BigInt(state.lastFetchedPrice),
    lastSubmittedPrice: state.lastSubmittedPrice === null ? null : BigInt(state.lastSubmittedPrice),
  };
}

export class FileStateStore {
  private readonly filePath: string;
  private cache: Record<string, OracleRuntimeState> = {};
  private persistTimer: NodeJS.Timeout | null = null;
  private pendingPersist: Promise<void> | null = null;

  constructor(filePath: string) {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.ensureDir();
    this.load();
  }

  get(key: string): OracleRuntimeState {
    if (!this.cache[key]) {
      this.cache[key] = defaultOracleState();
    }
    return this.cache[key];
  }

  entries(): Array<[string, OracleRuntimeState]> {
    return Object.entries(this.cache);
  }

  set(key: string, value: OracleRuntimeState): void {
    this.cache[key] = value;
    this.schedulePersist();
  }

  update(key: string, patch: Partial<OracleRuntimeState>): OracleRuntimeState {
    const existing = this.get(key);
    const next = { ...existing, ...patch };
    this.set(key, next);
    return next;
  }

  private load(): void {
    this.ensureDir();
    if (!fs.existsSync(this.filePath)) {
      this.cache = {};
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as SerializedState;
      const entries = Object.entries(parsed).map(([key, value]) => [key, deserializeState(value)] as const);
      this.cache = Object.fromEntries(entries);
    } catch (error: any) {
      this.cache = {};
      this.ensureDir();
      const backupPath = `${this.filePath}.corrupt`;
      try {
        fs.copyFileSync(this.filePath, backupPath);
      } catch {
        // ignore backup failures
      }
      // eslint-disable-next-line no-console
      console.warn(`State file corrupted. Resetting state. Path: ${this.filePath}. Error: ${error.message}`);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.pendingPersist = this.persistAsync();
    }, 200);
  }

  private async persistAsync(): Promise<void> {
    this.ensureDir();
    const serialized = Object.fromEntries(
      Object.entries(this.cache).map(([key, value]) => [key, serializeState(value)]),
    );
    await fs.promises.writeFile(this.filePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.pendingPersist) {
      await this.pendingPersist;
      this.pendingPersist = null;
    } else {
      await this.persistAsync();
    }
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
