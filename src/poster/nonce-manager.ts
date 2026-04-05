import { Address } from 'viem';
import { logger } from '../utils/logger';

type NonceClient = {
  getTransactionCount: (args: { address: Address; blockTag: 'pending' | 'latest' }) => Promise<number>;
  chain?: { id?: number };
};

interface PendingTransaction {
  nonce: number;
  hash?: string;
  submittedAt: Date;
}

export class NonceManager {
  private nextNonce: number | null = null;
  private availableNonces: number[] = [];
  private pendingTxs = new Map<number, PendingTransaction>();

  constructor(
    private client: NonceClient,
    private address: Address,
  ) {}

  async getNextNonce(): Promise<number> {
    const chainId = this.client.chain?.id;
    if (!chainId) {
      throw new Error('Missing chain id for nonce tracking');
    }

    if (this.availableNonces.length > 0) {
      const nonce = this.availableNonces.shift()!;
      logger.debug({ event: 'NONCE_REUSED', address: this.address, nonce, chainId });
      return nonce;
    }

    if (this.nextNonce === null) {
      const networkNext = await this.client.getTransactionCount({ address: this.address, blockTag: 'pending' });
      this.nextNonce = networkNext + 1;
      logger.debug({ event: 'NONCE_FETCHED', address: this.address, nonce: networkNext, chainId });
      return networkNext;
    }

    const nonce = this.nextNonce;
    this.nextNonce++;
    return nonce;
  }

  submitTransaction(nonce: number, txHash: string): void {
    this.pendingTxs.set(nonce, { nonce, hash: txHash, submittedAt: new Date() });
    logger.debug({ event: 'NONCE_TX_SUBMITTED', address: this.address, nonce, txHash, chainId: this.client.chain?.id });
  }

  markConfirmed(nonce: number): void {
    if (this.pendingTxs.delete(nonce)) {
      logger.debug({ event: 'NONCE_TX_CONFIRMED', address: this.address, nonce, chainId: this.client.chain?.id });
    }
  }

  markFailed(nonce: number): void {
    this.pendingTxs.delete(nonce);
    if (this.nextNonce !== null && nonce < this.nextNonce && !this.availableNonces.includes(nonce)) {
      this.availableNonces.push(nonce);
      this.availableNonces.sort((a, b) => a - b);
    }
    logger.debug({ event: 'NONCE_TX_FAILED', address: this.address, nonce, chainId: this.client.chain?.id });
  }

  getPendingCount(): number {
    return this.pendingTxs.size;
  }

  async syncWithNetwork(): Promise<{ networkPendingCount: number; networkNextNonce: number; networkLatestNonce: number }> {
    const chainId = this.client.chain?.id;
    if (!chainId) {
      throw new Error('Missing chain id for nonce tracking');
    }

    const [networkLatestNonce, networkNextNonce] = await Promise.all([
      this.client.getTransactionCount({ address: this.address, blockTag: 'latest' }),
      this.client.getTransactionCount({ address: this.address, blockTag: 'pending' }),
    ]);

    // Any nonce below latest has been mined (confirmed or replaced).
    for (const nonce of [...this.pendingTxs.keys()]) {
      if (nonce < networkLatestNonce) {
        this.pendingTxs.delete(nonce);
      }
    }

    this.availableNonces = this.availableNonces.filter((n) => n >= networkNextNonce);
    if (this.nextNonce !== null && this.nextNonce < networkNextNonce) {
      this.nextNonce = networkNextNonce;
    }

    const networkPendingCount = Math.max(0, networkNextNonce - networkLatestNonce);
    logger.debug({
      event: 'NONCE_SYNC',
      address: this.address,
      chainId,
      networkLatestNonce,
      networkNextNonce,
      networkPendingCount,
      localPendingCount: this.pendingTxs.size,
    });

    return { networkPendingCount, networkNextNonce, networkLatestNonce };
  }

  // useful in case of transaction failure or replacement
  resetNonce(): void {
    this.nextNonce = null;
    this.availableNonces = [];
    this.pendingTxs.clear();
    logger.debug({ event: 'NONCE_RESET', address: this.address, chainId: this.client.chain?.id });
  }
}
