import { createWalletClient, createPublicClient, http, parseAbi, getAddress, formatGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, scrollSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains';
import { logger } from '../utils/logger';
import { GasEstimator } from './gas-estimator';
import { NonceManager } from './nonce-manager';
import { OracleTarget } from '../config/schema';
import { withRetry } from '../utils/retry';
import { CircuitBreaker, CircuitState } from '../utils/circuit-breaker';
import { getMonitor } from '../monitor/ws-server';

// Minimal ABI for OrbOracle interactions
const orbOracleAbi = parseAbi([
  'function submitPrice(uint256 price) external',
  'function getTotalUserTokens(address user) view returns (uint256)',
]);

export class Submitter {
  private walletClient;
  private publicClient;
  private gasEstimator: GasEstimator;
  private nonceManager: NonceManager;
  private account;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private target: OracleTarget,
    privateKey: string,
    opts: {
      gasHistoryWindowSize?: number;
    } = {},
  ) {
    const pk = privateKey as `0x${string}`;
    this.account = privateKeyToAccount(pk);
    
    // Choose chain based on config (extend as needed)
    const chains: Record<number, any> = {
      1: mainnet,
      534351: scrollSepolia,
      84532: baseSepolia,
      421614: arbitrumSepolia
    };
    const chain = chains[target.chainId];
    if (!chain) {
      throw new Error(`Unsupported chainId ${target.chainId} in poster config`);
    }

    this.publicClient = createPublicClient({
      chain,
      transport: http(target.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(target.rpcUrl),
    });

    this.gasEstimator = new GasEstimator(this.publicClient, { historyWindowSize: opts.gasHistoryWindowSize });
    this.nonceManager = new NonceManager(this.publicClient, this.account.address);
    
    this.circuitBreaker = new CircuitBreaker(
      { failureThreshold: 5, failureWindowMs: 60000, resetTimeoutMs: 30000, openResetTimeoutMs: 60000 },
      `submitter.${target.chainId}`
    );
  }

  async getCurrentGasGwei(): Promise<number | undefined> {
    try {
      const { maxFeePerGas } = await this.gasEstimator.estimateGasFees();
      return Number(formatGwei(maxFeePerGas));
    } catch {
      return undefined;
    }
  }

  async estimateGasFees(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    return this.gasEstimator.estimateGasFees();
  }

  getPendingTxCount(): number {
    return this.nonceManager.getPendingCount();
  }

  async syncNonceWithNetwork(): Promise<void> {
    await this.nonceManager.syncWithNetwork();
  }

  async submitPrice(price: bigint, trigger: string): Promise<string> {
    return this.circuitBreaker.execute(async () =>
      withRetry(async () => this.doSubmitPrice(price, trigger), {
        maxAttempts: 3,
        operationName: `submitPrice.${this.target.chainId}`,
        isRetryable: Submitter.isRetryableError,
      })
    );
  }

  private async doSubmitPrice(price: bigint, trigger: string): Promise<string> {
    const token = this.target.pricePair.split('/')[0]?.trim().toUpperCase() || this.target.pricePair;
    let nonce: number | null = null;
    let hash: string | null = null;
    try {
      const address = getAddress(this.target.address);
      let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
      try {
        fees = await this.gasEstimator.estimateGasFees();
      } catch (error: any) {
        getMonitor()?.emitGasError({ error: error.message });
        throw error;
      }
      const { maxFeePerGas, maxPriorityFeePerGas } = fees;

      nonce = await this.nonceManager.getNextNonce();

      logger.info({ 
        event: 'SUBMITTING_TX', 
        target: address, 
        price: price.toString(),
        nonce 
      });

      const request = await this.publicClient.simulateContract({
        address,
        abi: orbOracleAbi,
        functionName: 'submitPrice',
        args: [price],
        account: this.account,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce,
      });

      hash = await this.walletClient.writeContract(request.request);

      this.nonceManager.submitTransaction(nonce, hash);
      getMonitor()?.emitSubmissionPending({ token, nonce, txHash: hash });
      
      logger.info({ 
        event: 'TX_SUBMITTED', 
        hash, 
        target: address, 
        price: price.toString(),
        trigger 
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== 'success') {
        this.nonceManager.markFailed(nonce);
        getMonitor()?.emitSubmissionFailed({ token, nonce, error: `Transaction reverted: ${hash}` });
        throw new Error(`Transaction reverted: ${hash}`);
      }

      this.nonceManager.markConfirmed(nonce);
      this.gasEstimator.recordPriorityFee(maxPriorityFeePerGas);
      getMonitor()?.emitSubmissionConfirmed({ token, nonce, txHash: hash });

      logger.info({ 
        event: 'SUBMISSION_SUCCESS',
        oracle: address,
        chain: this.target.chainId,
        pair: this.target.pricePair,
        price: price.toString(),
        trigger,
        gas_used: receipt.gasUsed.toString(),
        tx_hash: hash 
      });

      return hash;
    } catch (error: any) {
      const msg = error?.message || String(error);
      // If the tx was never submitted (no hash), release nonce for retry.
      if (nonce !== null && !hash) {
        this.nonceManager.markFailed(nonce);
        getMonitor()?.emitSubmissionFailed({ token, nonce, error: msg });
      }

      getMonitor()?.emitChainError({ error: msg });
      logger.error({ 
        event: 'TX_SUBMIT_ERROR', 
        error: msg, 
        target: this.target.address,
        retryable: Submitter.isRetryableError(error),
      });
      throw error;
    }
  }

  async hasSufficientStake(minStake: bigint): Promise<{ ok: boolean; total: bigint }> {
    if (minStake <= 0n) return { ok: true, total: 0n };
    try {
      const total = await this.publicClient.readContract({
        address: getAddress(this.target.address),
        abi: orbOracleAbi,
        functionName: 'getTotalUserTokens',
        args: [this.account.address],
      });
      return { ok: total >= minStake, total };
    } catch (error: any) {
      logger.error({
        event: 'STAKE_CHECK_FAILED',
        error: error.message,
        target: this.target.address,
      });
      return { ok: false, total: 0n };
    }
  }

  static isRetryableError(error: unknown): boolean {
    const err = error as Error & { code?: string };
    const msg = (err instanceof Error ? err.message : String(error)).toLowerCase();
    const code = (err?.code || '').toUpperCase();
    return (
      msg.includes('timeout') ||
      msg.includes('429') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504') ||
      msg.includes('network error') ||
      msg.includes('connection reset') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('dns') ||
      msg.includes('getaddrinfo') ||
      msg.includes('temporarily unavailable') ||
      msg.includes('nonce too low') ||
      msg.includes('replacement transaction underpriced') ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED'
    );
  }
}
