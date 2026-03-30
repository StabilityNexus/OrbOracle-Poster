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

  set(key: string, value: OracleRuntimeState): void {
    this.cache[key] = value;
    this.persist();
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

    const raw = fs.readFileSync(this.filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SerializedState;
    const entries = Object.entries(parsed).map(([key, value]) => [key, deserializeState(value)] as const);
    this.cache = Object.fromEntries(entries);
  }

  private persist(): void {
    this.ensureDir();
    const serialized = Object.fromEntries(
      Object.entries(this.cache).map(([key, value]) => [key, serializeState(value)]),
    );
    fs.writeFileSync(this.filePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
