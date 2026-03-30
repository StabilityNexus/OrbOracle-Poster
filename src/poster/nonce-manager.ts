import { Address } from 'viem';
import { logger } from '../utils/logger';

type NonceClient = {
  getTransactionCount: (args: { address: Address; blockTag: 'pending' }) => Promise<number>;
  chain?: { id?: number };
};

export class NonceManager {
  private nonces = new Map<string, number>();

  constructor(private client: NonceClient) {}

  async getNextNonce(address: Address): Promise<number> {
    const key = `${this.client.chain?.id}-${address}`;
    let nonce = this.nonces.get(key);

    if (nonce === undefined) {
      // Fetch from network if not tracked locally
      nonce = await this.client.getTransactionCount({ address, blockTag: 'pending' });
      logger.debug({ event: 'NONCE_FETCHED', address, nonce, chainId: this.client.chain?.id });
    } else {
      nonce++; // Increment local nonce
    }

    this.nonces.set(key, nonce);
    return nonce;
  }

  // useful in case of transaction failure or replacement
  resetNonce(address: Address) {
    const key = `${this.client.chain?.id}-${address}`;
    this.nonces.delete(key);
    logger.debug({ event: 'NONCE_RESET', address, chainId: this.client.chain?.id });
  }
}
