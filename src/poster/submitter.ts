import { createWalletClient, createPublicClient, http, parseAbi, getAddress, formatGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, scrollSepolia, baseSepolia, arbitrumSepolia } from 'viem/chains';
import { logger } from '../utils/logger';
import { GasEstimator } from './gas-estimator';
import { NonceManager } from './nonce-manager';
import { OracleTarget } from '../config/schema';

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

  constructor(private target: OracleTarget, privateKey: string) {
    const pk = privateKey as `0x${string}`;
    this.account = privateKeyToAccount(pk);
    
    // Choose chain based on config (extend as needed)
    const chains: Record<number, any> = {
      1: mainnet,
      534351: scrollSepolia,
      84532: baseSepolia,
      421614: arbitrumSepolia
    };
    const chain = chains[target.chainId] || mainnet; // Default to mainnet/custom

    this.publicClient = createPublicClient({
      chain,
      transport: http(target.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(target.rpcUrl),
    });

    this.gasEstimator = new GasEstimator(this.publicClient);
    this.nonceManager = new NonceManager(this.publicClient);
  }

  async getCurrentGasGwei(): Promise<number | undefined> {
    try {
      const { maxFeePerGas } = await this.gasEstimator.estimateGasFees();
      return Number(formatGwei(maxFeePerGas));
    } catch {
      return undefined;
    }
  }

  async submitPrice(price: bigint, trigger: string): Promise<string> {
    try {
      const address = getAddress(this.target.address);
      const { maxFeePerGas, maxPriorityFeePerGas } = await this.gasEstimator.estimateGasFees();
      const nonce = await this.nonceManager.getNextNonce(this.account.address);

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

      const hash = await this.walletClient.writeContract(request.request);
      
      logger.info({ 
        event: 'TX_SUBMITTED', 
        hash, 
        target: address, 
        price: price.toString(),
        trigger 
      });

      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status !== 'success') {
        throw new Error(`Transaction reverted: ${hash}`);
      }

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
      this.nonceManager.resetNonce(this.account.address); // Reset on failure
      logger.error({ 
        event: 'TX_SUBMIT_ERROR', 
        error: error.message, 
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
    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return msg.includes('timeout') || msg.includes('429') || msg.includes('nonce too low') || msg.includes('replacement transaction underpriced');
  }
}
